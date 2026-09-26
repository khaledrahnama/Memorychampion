// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title MemoryGame
/// @notice Scheduled memory-challenge games on Monad: funded MON prize pools,
///         wallet registration, reward finalization via a Merkle commitment,
///         and reward claims. The contract never sees questions or answers —
///         the backend grades off-chain and publishes only who is paid what.
///
/// Accounting per game:
///   pool      = organizer funding + entry fees collected
///   allocated = total rewards committed at finalization (<= pool)
///   claimed   = rewards / refunds already paid out
///   After finalization the organizer may withdraw (pool - allocated) once;
///   winners' allocated rewards can never be taken back by the organizer.
contract MemoryGame is Ownable, ReentrancyGuard {
    enum Status {
        Open, // registration open, before startTime
        Live, // startTime has passed, not yet finalized
        Finalized, // rewardsRoot published, claims open
        Cancelled // cancelled before start; refunds open
    }

    struct Game {
        uint64 startTime;
        uint32 participantCount;
        bool finalized;
        bool cancelled;
        bool organizerWithdrawn;
        address organizer;
        uint128 funding; // MON the organizer put in, in wei
        uint128 entryFee; // optional per-player entry fee, 0 for free games
        uint128 pool; // funding + entry fees collected
        uint128 allocated; // rewards committed at finalization
        uint128 claimed; // rewards / refunds paid out so far
        uint128 rewardsPaid; // portion of `claimed` paid as rewards (bounded by `allocated`)
        bytes32 rewardsRoot; // Merkle root of (wallet, amount) leaves
    }

    uint256 public nextGameId;
    mapping(uint256 => Game) internal games;
    mapping(uint256 => mapping(address => bool)) public isRegistered;
    mapping(uint256 => mapping(address => bool)) public hasClaimed;

    /// @notice Address allowed to create, finalize and cancel games (the backend's operator key).
    address public operator;

    event GameCreated(uint256 indexed gameId, uint64 startTime, uint256 funding, uint256 entryFee, address organizer);
    event PlayerJoined(uint256 indexed gameId, address indexed player, uint32 participantCount);
    event GameFinalized(uint256 indexed gameId, bytes32 rewardsRoot, uint256 allocated);
    event RewardClaimed(uint256 indexed gameId, address indexed player, uint256 amount);
    event GameCancelled(uint256 indexed gameId);
    event Refunded(uint256 indexed gameId, address indexed to, uint256 amount);
    event OperatorUpdated(address indexed newOperator);

    modifier onlyOperator() {
        require(msg.sender == operator || msg.sender == owner(), "MemoryGame: not operator");
        _;
    }

    constructor(address initialOperator) Ownable(msg.sender) {
        operator = initialOperator == address(0) ? msg.sender : initialOperator;
    }

    function setOperator(address newOperator) external onlyOwner {
        require(newOperator != address(0), "MemoryGame: zero operator");
        operator = newOperator;
        emit OperatorUpdated(newOperator);
    }

    /// @notice Create and fund a new game. `msg.value` becomes the prize pool.
    /// @param startTime Unix timestamp when the game starts; registration closes then.
    /// @param entryFee Per-player entry fee in wei (0 for a free game).
    function createGame(uint64 startTime, uint128 entryFee) external payable onlyOperator returns (uint256 gameId) {
        require(startTime > block.timestamp, "MemoryGame: startTime must be in the future");

        gameId = nextGameId++;
        Game storage g = games[gameId];
        g.startTime = startTime;
        g.funding = uint128(msg.value);
        g.pool = uint128(msg.value);
        g.entryFee = entryFee;
        g.organizer = msg.sender;

        emit GameCreated(gameId, startTime, msg.value, entryFee, msg.sender);
    }

    /// @notice Register the caller's wallet for a game before it starts.
    function joinGame(uint256 gameId) external payable nonReentrant {
        Game storage g = games[gameId];
        require(g.organizer != address(0), "MemoryGame: game does not exist");
        require(!g.cancelled, "MemoryGame: game cancelled");
        require(block.timestamp < g.startTime, "MemoryGame: registration closed");
        require(!isRegistered[gameId][msg.sender], "MemoryGame: already registered");
        require(msg.value == g.entryFee, "MemoryGame: incorrect entry fee");

        isRegistered[gameId][msg.sender] = true;
        g.participantCount += 1;
        g.pool += uint128(msg.value);

        emit PlayerJoined(gameId, msg.sender, g.participantCount);
    }

    /// @notice Publish the reward allocation for a finished game.
    /// @param rewardsRoot Merkle root over leaves keccak256(bytes.concat(keccak256(abi.encode(wallet, amount)))).
    ///        Use bytes32(0) with totalAllocated = 0 when nobody won.
    /// @param totalAllocated Sum of all amounts in the tree; must not exceed the pool.
    function finalizeGame(uint256 gameId, bytes32 rewardsRoot, uint128 totalAllocated) external onlyOperator {
        Game storage g = games[gameId];
        require(g.organizer != address(0), "MemoryGame: game does not exist");
        require(!g.cancelled, "MemoryGame: game cancelled");
        require(block.timestamp >= g.startTime, "MemoryGame: game has not started");
        require(!g.finalized, "MemoryGame: already finalized");
        require(totalAllocated <= g.pool, "MemoryGame: allocation exceeds pool");
        require((rewardsRoot == bytes32(0)) == (totalAllocated == 0), "MemoryGame: root/allocation mismatch");

        g.finalized = true;
        g.rewardsRoot = rewardsRoot;
        g.allocated = totalAllocated;

        emit GameFinalized(gameId, rewardsRoot, totalAllocated);
    }

    /// @notice Claim a reward allocated in finalizeGame's Merkle root.
    function claimReward(uint256 gameId, uint256 amount, bytes32[] calldata proof) external nonReentrant {
        Game storage g = games[gameId];
        require(g.finalized, "MemoryGame: not finalized");
        require(!hasClaimed[gameId][msg.sender], "MemoryGame: already claimed");

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, amount))));
        require(MerkleProof.verify(proof, g.rewardsRoot, leaf), "MemoryGame: invalid proof");

        require(g.rewardsPaid + amount <= g.allocated, "MemoryGame: exceeds allocation");

        hasClaimed[gameId][msg.sender] = true;
        g.claimed += uint128(amount);
        g.rewardsPaid += uint128(amount);

        (bool sent, ) = msg.sender.call{value: amount}("");
        require(sent, "MemoryGame: transfer failed");

        emit RewardClaimed(gameId, msg.sender, amount);
    }

    /// @notice Cancel a game before it starts. Entry fees and funding become refundable.
    function cancelGame(uint256 gameId) external onlyOperator {
        Game storage g = games[gameId];
        require(g.organizer != address(0), "MemoryGame: game does not exist");
        require(block.timestamp < g.startTime, "MemoryGame: already started");
        require(!g.cancelled, "MemoryGame: already cancelled");

        g.cancelled = true;
        emit GameCancelled(gameId);
    }

    /// @notice Organizer withdraws what belongs back to them, once:
    ///         - after cancellation: their original funding (players refund their own fees)
    ///         - after finalization: everything not allocated to winners (the whole pool if nobody won)
    function withdrawUnclaimed(uint256 gameId) external nonReentrant {
        Game storage g = games[gameId];
        require(msg.sender == g.organizer, "MemoryGame: not organizer");
        require(g.cancelled || g.finalized, "MemoryGame: game still open");
        require(!g.organizerWithdrawn, "MemoryGame: already withdrawn");

        uint256 amount = g.cancelled ? g.funding : g.pool - g.allocated;
        require(amount > 0, "MemoryGame: nothing to withdraw");

        g.organizerWithdrawn = true;
        g.claimed += uint128(amount);

        (bool sent, ) = msg.sender.call{value: amount}("");
        require(sent, "MemoryGame: transfer failed");

        emit Refunded(gameId, msg.sender, amount);
    }

    /// @notice A registered player reclaims their entry fee if the game was cancelled.
    function refundEntryFee(uint256 gameId) external nonReentrant {
        Game storage g = games[gameId];
        require(g.cancelled, "MemoryGame: not cancelled");
        require(isRegistered[gameId][msg.sender], "MemoryGame: not registered");
        require(!hasClaimed[gameId][msg.sender], "MemoryGame: already refunded");
        require(g.entryFee > 0, "MemoryGame: no entry fee to refund");

        hasClaimed[gameId][msg.sender] = true;
        g.claimed += g.entryFee;

        (bool sent, ) = msg.sender.call{value: g.entryFee}("");
        require(sent, "MemoryGame: transfer failed");

        emit Refunded(gameId, msg.sender, g.entryFee);
    }

    function getGame(uint256 gameId)
        external
        view
        returns (
            uint64 startTime,
            uint256 pool,
            uint256 claimed,
            uint32 participantCount,
            uint128 entryFee,
            Status status
        )
    {
        Game storage g = games[gameId];
        require(g.organizer != address(0), "MemoryGame: game does not exist");

        Status s;
        if (g.cancelled) {
            s = Status.Cancelled;
        } else if (g.finalized) {
            s = Status.Finalized;
        } else if (block.timestamp >= g.startTime) {
            s = Status.Live;
        } else {
            s = Status.Open;
        }

        return (g.startTime, g.pool, g.claimed, g.participantCount, g.entryFee, s);
    }

    /// @notice Extra accounting details (used by the admin screen).
    function getGameAccounting(uint256 gameId)
        external
        view
        returns (
            address organizer,
            uint256 funding,
            uint256 allocated,
            uint256 rewardsPaid,
            bool organizerWithdrawn,
            bytes32 rewardsRoot
        )
    {
        Game storage g = games[gameId];
        require(g.organizer != address(0), "MemoryGame: game does not exist");
        return (g.organizer, g.funding, g.allocated, g.rewardsPaid, g.organizerWithdrawn, g.rewardsRoot);
    }
}

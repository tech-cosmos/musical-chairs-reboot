from reboot.api import (
    API,
    Field,
    Methods,
    Model,
    Reader,
    Transaction,
    Type,
    Writer,
)

# Phases: LOBBY -> MUSIC -> SCRAMBLE -> (MUSIC ... ) -> ROUND_OVER -> LOBBY


class Chair(Model):
    chair_id: int = Field(tag=1)
    # A correctly-claimed chair has exactly one occupant. The naive
    # check-then-act path can seat multiple players here — that is the
    # "two buyers, one remaining item" bug made visible.
    occupants: list[str] = Field(tag=2, default_factory=list)


class GameState(Model):
    phase: str = Field(tag=1)
    game_number: int = Field(tag=2)
    round_number: int = Field(tag=3)
    entry_fee: int = Field(tag=4)
    pot: int = Field(tag=5)
    players: list[str] = Field(tag=6, default_factory=list)
    active: list[str] = Field(tag=7, default_factory=list)
    chairs: list[Chair] = Field(tag=8, default_factory=list)
    eliminated_last: list[str] = Field(tag=9, default_factory=list)
    last_winner: str = Field(tag=10)
    # Coin-conservation ledger: every coin ever minted must equal
    # sum(player balances) + pot + payouts. Naive flows break this.
    minted: int = Field(tag=11)
    payouts: int = Field(tag=12)
    registered: list[str] = Field(tag=13, default_factory=list)
    events: list[str] = Field(tag=14, default_factory=list)
    # Chaos: artificial latency inside join, to widen the window for
    # "the timeout that lied" and kill-the-server demos.
    slow_join_ms: int = Field(tag=15)
    version: int = Field(tag=16)
    # Entry fees added to the pot by the naive `enroll` path, which
    # never verifies a payment happened. A nonzero value here means
    # the books are cooked even if the totals happen to cancel out.
    unverified_fees: int = Field(tag=17, default=0)


class GameSnapshotResponse(Model):
    phase: str = Field(tag=1)
    game_number: int = Field(tag=2)
    round_number: int = Field(tag=3)
    entry_fee: int = Field(tag=4)
    pot: int = Field(tag=5)
    players: list[str] = Field(tag=6, default_factory=list)
    active: list[str] = Field(tag=7, default_factory=list)
    chairs: list[Chair] = Field(tag=8, default_factory=list)
    eliminated_last: list[str] = Field(tag=9, default_factory=list)
    last_winner: str = Field(tag=10)
    events: list[str] = Field(tag=11, default_factory=list)
    slow_join_ms: int = Field(tag=12)
    version: int = Field(tag=13)


class PlayerBalance(Model):
    player_id: str = Field(tag=1)
    coins: int = Field(tag=2)
    wins: int = Field(tag=3)


class DashboardResponse(Model):
    minted: int = Field(tag=1)
    total_balances: int = Field(tag=2)
    pot: int = Field(tag=3)
    payouts: int = Field(tag=4)
    missing: int = Field(tag=5)
    coins_conserved: bool = Field(tag=6)
    overbooked_chairs: int = Field(tag=7)
    balances: list[PlayerBalance] = Field(tag=8, default_factory=list)
    unverified_fees: int = Field(tag=9, default=0)


class RegisterRequest(Model):
    player_id: str = Field(tag=1)
    starting_coins: int = Field(tag=2)


class RecordMintRequest(Model):
    amount: int = Field(tag=1)


class JoinRequest(Model):
    player_id: str = Field(tag=1)


class EnrollRequest(Model):
    player_id: str = Field(tag=1)


class ClaimRequest(Model):
    player_id: str = Field(tag=1)
    chair_id: int = Field(tag=2)


class ChairQueryRequest(Model):
    chair_id: int = Field(tag=1)


class ChairQueryResponse(Model):
    available: bool = Field(tag=1)


class RoundGuardRequest(Model):
    game_number: int = Field(tag=1)
    round_number: int = Field(tag=2)


class PayoutRequest(Model):
    game_number: int = Field(tag=1)


class SetChaosRequest(Model):
    slow_join_ms: int = Field(tag=1)


# Typed errors: the antidote to "the 200 that hid a failure".
class NotInLobby(Model):
    message: str = Field(tag=1)


class AlreadyJoined(Model):
    message: str = Field(tag=1)


class NotEnoughCoins(Model):
    message: str = Field(tag=1)


class NotEnoughPlayers(Model):
    message: str = Field(tag=1)


class NotInScramble(Model):
    message: str = Field(tag=1)


class ChairTaken(Model):
    message: str = Field(tag=1)


class AlreadySeated(Model):
    message: str = Field(tag=1)


class NotActive(Model):
    message: str = Field(tag=1)


GameMethods = Methods(
    create=Writer(
        request=None,
        response=None,
        factory=True,
        mcp=None,
    ),
    get=Reader(
        request=None,
        response=GameSnapshotResponse,
        mcp=None,
    ),
    dashboard=Reader(
        request=None,
        response=DashboardResponse,
        mcp=None,
    ),
    register=Writer(
        request=RegisterRequest,
        response=None,
        mcp=None,
    ),
    record_mint=Writer(
        request=RecordMintRequest,
        response=None,
        mcp=None,
    ),
    # Hardened entry: charge the player AND enroll them, atomically.
    join=Transaction(
        request=JoinRequest,
        response=None,
        errors=[NotInLobby, AlreadyJoined, NotEnoughCoins],
        mcp=None,
    ),
    # Naive entry: enrollment only — the client is expected to have
    # charged the player separately. No duplicate check, no atomicity.
    enroll=Writer(
        request=EnrollRequest,
        response=None,
        mcp=None,
    ),
    start=Writer(
        request=None,
        response=None,
        errors=[NotInLobby, NotEnoughPlayers],
        mcp=None,
    ),
    stop_music=Writer(
        request=RoundGuardRequest,
        response=None,
        mcp=None,
    ),
    # Hardened claim: atomic check-and-sit inside a single writer.
    claim=Writer(
        request=ClaimRequest,
        response=None,
        errors=[NotInScramble, ChairTaken, AlreadySeated, NotActive],
        mcp=None,
    ),
    # Naive claim: check-then-act split across two calls.
    chair_available=Reader(
        request=ChairQueryRequest,
        response=ChairQueryResponse,
        mcp=None,
    ),
    naive_sit=Writer(
        request=ClaimRequest,
        response=None,
        mcp=None,
    ),
    scramble_timeout=Writer(
        request=RoundGuardRequest,
        response=None,
        mcp=None,
    ),
    payout=Transaction(
        request=PayoutRequest,
        response=None,
        mcp=None,
    ),
    set_chaos=Writer(
        request=SetChaosRequest,
        response=None,
        mcp=None,
    ),
    touch=Writer(
        request=None,
        response=None,
        mcp=None,
    ),
    reset=Writer(
        request=None,
        response=None,
        mcp=None,
    ),
)

api = API(
    Game=Type(
        state=GameState,
        methods=GameMethods,
    ),
)

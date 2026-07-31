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


class PlayerState(Model):
    coins: int = Field(tag=1)
    wins: int = Field(tag=2)


class PlayerInfoResponse(Model):
    coins: int = Field(tag=1)
    wins: int = Field(tag=2)


class DepositRequest(Model):
    amount: int = Field(tag=1)


class WithdrawRequest(Model):
    amount: int = Field(tag=1)


class InsufficientCoins(Model):
    shortfall: int = Field(tag=1)


class NaiveWithdrawRequest(Model):
    amount: int = Field(tag=1)
    # Artificial processing delay — used to demo "the timeout that
    # lied": the client gives up before the server finishes, but the
    # server finishes anyway.
    delay_ms: int = Field(tag=2, default=0)


# The "200 that hid a failure": always a successful response; the
# actual outcome is buried in the body where a careless client (or a
# careless agent) never looks.
class NaiveWithdrawResponse(Model):
    status: str = Field(tag=1)
    charged: bool = Field(tag=2)


class BuyCoinsRequest(Model):
    amount: int = Field(tag=1)


class RecordWinRequest(Model):
    amount: int = Field(tag=1)


PlayerMethods = Methods(
    # Must use this method to create an instance of Player; registers
    # the player with the Game and mints their starting coins in one
    # atomic transaction.
    create=Transaction(
        request=None,
        response=None,
        factory=True,
        mcp=None,
    ),
    get=Reader(
        request=None,
        response=PlayerInfoResponse,
        mcp=None,
    ),
    deposit=Writer(
        request=DepositRequest,
        response=None,
        mcp=None,
    ),
    withdraw=Writer(
        request=WithdrawRequest,
        response=None,
        errors=[InsufficientCoins],
        mcp=None,
    ),
    naive_withdraw=Writer(
        request=NaiveWithdrawRequest,
        response=NaiveWithdrawResponse,
        mcp=None,
    ),
    buy_coins=Transaction(
        request=BuyCoinsRequest,
        response=None,
        mcp=None,
    ),
    record_win=Writer(
        request=RecordWinRequest,
        response=None,
        mcp=None,
    ),
)

api = API(
    Player=Type(
        state=PlayerState,
        methods=PlayerMethods,
    ),
)

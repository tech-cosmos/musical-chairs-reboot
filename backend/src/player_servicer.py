import asyncio
from chairs.v1.game_rbt import Game
from chairs.v1.player import InsufficientCoins
from chairs.v1.player_rbt import Player
from constants import GAME_ID, STARTING_COINS
from reboot.aio.auth.authorizers import allow
from reboot.aio.contexts import (
    ReaderContext,
    TransactionContext,
    WriterContext,
)


class PlayerServicer(Player.Servicer):

    def authorizer(self):
        return allow()

    async def create(
        self,
        context: TransactionContext,
    ) -> None:
        # Minting coins and registering with the game happen atomically:
        # there is no window where a player exists but the game's
        # coin-conservation ledger doesn't know about their coins.
        self.state.coins = STARTING_COINS
        self.state.wins = 0
        await Game.ref(GAME_ID).register(
            context,
            player_id=self.ref().state_id,
            starting_coins=STARTING_COINS,
        )

    async def get(
        self,
        context: ReaderContext,
    ) -> Player.GetResponse:
        return Player.GetResponse(
            coins=self.state.coins,
            wins=self.state.wins,
        )

    async def deposit(
        self,
        context: WriterContext,
        request: Player.DepositRequest,
    ) -> None:
        self.state.coins += request.amount

    async def withdraw(
        self,
        context: WriterContext,
        request: Player.WithdrawRequest,
    ) -> None:
        if self.state.coins < request.amount:
            raise Player.WithdrawAborted(
                InsufficientCoins(shortfall=request.amount - self.state.coins)
            )
        self.state.coins -= request.amount

    async def naive_withdraw(
        self,
        context: WriterContext,
        request: Player.NaiveWithdrawRequest,
    ) -> Player.NaiveWithdrawResponse:
        # The "200 that hid a failure": this method NEVER errors. When
        # the player can't afford the charge it just... doesn't charge,
        # and reports success anyway. The truth is buried in `charged`,
        # where a client that only checks the status code never looks.
        if request.delay_ms > 0:
            await asyncio.sleep(request.delay_ms / 1000)
        if self.state.coins < request.amount:
            return Player.NaiveWithdrawResponse(status="ok", charged=False)
        self.state.coins -= request.amount
        return Player.NaiveWithdrawResponse(status="ok", charged=True)

    async def buy_coins(
        self,
        context: TransactionContext,
        request: Player.BuyCoinsRequest,
    ) -> None:
        self.state.coins += request.amount
        # Record the mint atomically so coin conservation still holds.
        await Game.ref(GAME_ID).record_mint(context, amount=request.amount)

    async def record_win(
        self,
        context: WriterContext,
        request: Player.RecordWinRequest,
    ) -> None:
        self.state.coins += request.amount
        self.state.wins += 1

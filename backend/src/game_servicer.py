import asyncio
import random
from chairs.v1.game import (
    AlreadyJoined,
    AlreadySeated,
    Chair,
    ChairTaken,
    NotActive,
    NotEnoughCoins,
    NotEnoughPlayers,
    NotInLobby,
    NotInScramble,
    PlayerBalance,
)
from chairs.v1.game_rbt import Game
from chairs.v1.player_rbt import Player
from datetime import timedelta
from reboot.aio.auth.authorizers import allow
from reboot.aio.contexts import (
    ReaderContext,
    TransactionContext,
    WriterContext,
)

LOBBY = "LOBBY"
MUSIC = "MUSIC"
SCRAMBLE = "SCRAMBLE"
ROUND_OVER = "ROUND_OVER"

MAX_EVENTS = 30


class GameServicer(Game.Servicer):

    def authorizer(self):
        return allow()

    def _log(self, message: str) -> None:
        self.state.events.insert(0, message)
        del self.state.events[MAX_EVENTS:]
        self.state.version += 1

    async def create(
        self,
        context: WriterContext,
    ) -> None:
        s = self.state
        s.phase = LOBBY
        s.game_number = 1
        s.round_number = 0
        s.entry_fee = 10
        s.pot = 0
        s.last_winner = ""
        s.minted = 0
        s.payouts = 0
        s.slow_join_ms = 0
        s.version = 0
        self._log("🎪 Musical Chairs is open for business")

    async def get(
        self,
        context: ReaderContext,
    ) -> Game.GetResponse:
        s = self.state
        return Game.GetResponse(
            phase=s.phase,
            game_number=s.game_number,
            round_number=s.round_number,
            entry_fee=s.entry_fee,
            pot=s.pot,
            players=s.players,
            active=s.active,
            chairs=s.chairs,
            eliminated_last=s.eliminated_last,
            last_winner=s.last_winner,
            events=s.events,
            slow_join_ms=s.slow_join_ms,
            version=s.version,
        )

    async def dashboard(
        self,
        context: ReaderContext,
    ) -> Game.DashboardResponse:
        s = self.state

        async def balance(player_id: str) -> PlayerBalance:
            info = await Player.ref(player_id).get(context)
            return PlayerBalance(
                player_id=player_id,
                coins=info.coins,
                wins=info.wins,
            )

        balances = list(
            await asyncio.gather(*[balance(p) for p in s.registered])
        )
        total_balances = sum(b.coins for b in balances)

        # Conservation of coins: every coin ever minted is either in a
        # player's balance or in the pot. (`payouts` is informational —
        # paid-out coins are back in balances.) A red `missing` number
        # means a naive flow destroyed or conjured money.
        missing = s.minted - total_balances - s.pot
        overbooked = sum(
            1 for chair in s.chairs if len(chair.occupants) > 1
        )

        return Game.DashboardResponse(
            minted=s.minted,
            total_balances=total_balances,
            pot=s.pot,
            payouts=s.payouts,
            missing=missing,
            coins_conserved=missing == 0,
            overbooked_chairs=overbooked,
            balances=balances,
            unverified_fees=s.unverified_fees,
        )

    async def register(
        self,
        context: WriterContext,
        request: Game.RegisterRequest,
    ) -> None:
        if request.player_id in self.state.registered:
            return
        self.state.registered.append(request.player_id)
        self.state.minted += request.starting_coins
        self._log(
            f"👋 {request.player_id} showed up with "
            f"{request.starting_coins} coins"
        )

    async def record_mint(
        self,
        context: WriterContext,
        request: Game.RecordMintRequest,
    ) -> None:
        self.state.minted += request.amount
        self.state.version += 1

    async def join(
        self,
        context: TransactionContext,
        request: Game.JoinRequest,
    ) -> None:
        # The hardened entry path: charging the player and enrolling
        # them happen in ONE transaction. A crash anywhere in between
        # rolls back everything — no coins vanish.
        s = self.state
        player_id = request.player_id
        if s.phase != LOBBY:
            raise Game.JoinAborted(
                NotInLobby(message="Wait for the next game to join.")
            )
        if player_id in s.players:
            raise Game.JoinAborted(
                AlreadyJoined(message="You are already in this game.")
            )

        # Chaos: widen the crash/timeout window between the charge and
        # the enrollment. With a transaction this stays safe no matter
        # how long the window is.
        if s.slow_join_ms > 0:
            await asyncio.sleep(s.slow_join_ms / 1000)

        # Check-then-act on ANOTHER state — safe here, because a
        # transaction sees and mutates a consistent snapshot.
        info = await Player.ref(player_id).get(context)
        if info.coins < s.entry_fee:
            raise Game.JoinAborted(
                NotEnoughCoins(
                    message=f"Entry costs {s.entry_fee} coins; "
                    f"you have {info.coins}."
                )
            )
        await Player.ref(player_id).withdraw(context, amount=s.entry_fee)

        s.pot += s.entry_fee
        s.players.append(player_id)
        self._log(f"💺 {player_id} paid {s.entry_fee} and joined the game")

    async def enroll(
        self,
        context: WriterContext,
        request: Game.EnrollRequest,
    ) -> None:
        # The naive entry path: enrollment only. The caller is trusted
        # to have charged the player in a SEPARATE request. No
        # duplicate check either — a retried enrollment enters (and a
        # separately-retried charge bills) the player twice.
        s = self.state
        if s.phase != LOBBY:
            # Silently do nothing. Naive code loves doing that.
            return
        s.pot += s.entry_fee
        s.unverified_fees += s.entry_fee
        s.players.append(request.player_id)
        self._log(f"🤞 {request.player_id} enrolled (naive path)")

    async def start(
        self,
        context: WriterContext,
    ) -> None:
        s = self.state
        if s.phase != LOBBY:
            raise Game.StartAborted(
                NotInLobby(message="A game is already in progress.")
            )
        if len(s.players) < 2:
            raise Game.StartAborted(
                NotEnoughPlayers(
                    message="Need at least 2 players to start."
                )
            )
        s.active = list(s.players)
        s.round_number = 1
        s.phase = MUSIC
        self._log(
            f"🎶 Game #{s.game_number} started with "
            f"{len(s.active)} players — the music is playing!"
        )
        await self.ref().schedule(
            when=timedelta(seconds=random.randint(3, 6)),
        ).stop_music(
            context,
            game_number=s.game_number,
            round_number=s.round_number,
        )

    async def stop_music(
        self,
        context: WriterContext,
        request: Game.StopMusicRequest,
    ) -> None:
        s = self.state
        # Stale scheduled tasks (from a reset game) must no-op.
        if (
            s.phase != MUSIC or s.game_number != request.game_number or
            s.round_number != request.round_number
        ):
            return
        s.chairs = [
            Chair(chair_id=i) for i in range(len(s.active) - 1)
        ]
        s.phase = SCRAMBLE
        self._log(
            f"🛑 MUSIC STOPPED! {len(s.active)} players, "
            f"{len(s.chairs)} chairs — GO!"
        )
        await self.ref().schedule(
            when=timedelta(seconds=12),
        ).scramble_timeout(
            context,
            game_number=s.game_number,
            round_number=s.round_number,
        )

    async def claim(
        self,
        context: WriterContext,
        request: Game.ClaimRequest,
    ) -> None:
        # The hardened claim: check-and-sit is one atomic writer.
        # Writers on a state are serialized, so two players racing for
        # the last chair cannot both win it.
        s = self.state
        player_id = request.player_id
        if s.phase != SCRAMBLE:
            raise Game.ClaimAborted(
                NotInScramble(message="The music is still playing!")
            )
        if player_id not in s.active:
            raise Game.ClaimAborted(
                NotActive(message="You are not in this round.")
            )
        if any(player_id in chair.occupants for chair in s.chairs):
            raise Game.ClaimAborted(
                AlreadySeated(message="You are already sitting down.")
            )
        chair = next(
            (c for c in s.chairs if c.chair_id == request.chair_id),
            None,
        )
        if chair is None:
            raise Game.ClaimAborted(
                NotInScramble(message="No such chair.")
            )
        if chair.occupants:
            raise Game.ClaimAborted(
                ChairTaken(
                    message=f"{chair.occupants[0]} got there first!"
                )
            )
        chair.occupants.append(player_id)
        self._log(f"🪑 {player_id} grabbed chair {chair.chair_id + 1}")
        if all(c.occupants for c in s.chairs):
            await self._finish_scramble(context)

    async def chair_available(
        self,
        context: ReaderContext,
        request: Game.ChairAvailableRequest,
    ) -> Game.ChairAvailableResponse:
        chair = next(
            (
                c for c in self.state.chairs
                if c.chair_id == request.chair_id
            ),
            None,
        )
        return Game.ChairAvailableResponse(
            available=chair is not None and not chair.occupants,
        )

    async def naive_sit(
        self,
        context: WriterContext,
        request: Game.ClaimRequest,
    ) -> None:
        # The naive claim: the availability check happened in a
        # SEPARATE read (`chair_available`). By the time this write
        # lands, someone else may have sat down — and we don't look.
        s = self.state
        if s.phase != SCRAMBLE:
            return  # Silently do nothing, again.
        chair = next(
            (c for c in s.chairs if c.chair_id == request.chair_id),
            None,
        )
        if chair is None:
            return
        chair.occupants.append(request.player_id)
        if len(chair.occupants) > 1:
            self._log(
                f"💥 chair {chair.chair_id + 1} now has "
                f"{len(chair.occupants)} occupants: "
                f"{', '.join(chair.occupants)}"
            )
        else:
            self._log(
                f"🪑 {request.player_id} grabbed chair "
                f"{chair.chair_id + 1} (naive path)"
            )
        if all(c.occupants for c in s.chairs):
            await self._finish_scramble(context)

    async def scramble_timeout(
        self,
        context: WriterContext,
        request: Game.ScrambleTimeoutRequest,
    ) -> None:
        s = self.state
        if (
            s.phase != SCRAMBLE or s.game_number != request.game_number or
            s.round_number != request.round_number
        ):
            return
        self._log("⏰ Time's up! Anyone still standing is out.")
        await self._finish_scramble(context)

    async def _finish_scramble(self, context: WriterContext) -> None:
        s = self.state
        seated = {
            occupant
            for chair in s.chairs for occupant in chair.occupants
        }
        eliminated = [p for p in s.active if p not in seated]
        survivors = [p for p in s.active if p in seated]
        s.eliminated_last = eliminated
        s.active = survivors
        if eliminated:
            self._log(f"❌ Eliminated: {', '.join(eliminated)}")

        if len(survivors) <= 1:
            s.phase = ROUND_OVER
            s.last_winner = survivors[0] if survivors else ""
            if s.last_winner:
                self._log(
                    f"🏆 {s.last_winner} wins the pot of {s.pot} coins!"
                )
            else:
                self._log(
                    "🫥 Nobody sat down?! The pot carries over."
                )
            await self.ref().schedule(
                when=timedelta(seconds=3),
            ).payout(context, game_number=s.game_number)
        else:
            s.round_number += 1
            s.phase = MUSIC
            self._log(
                f"🎶 Round {s.round_number}: {len(survivors)} players "
                "left — the music plays again!"
            )
            await self.ref().schedule(
                when=timedelta(seconds=random.randint(3, 6)),
            ).stop_music(
                context,
                game_number=s.game_number,
                round_number=s.round_number,
            )

    async def payout(
        self,
        context: TransactionContext,
        request: Game.PayoutRequest,
    ) -> None:
        # Paying the winner and resetting the game is atomic — the
        # durable version of "the crash between the charge and the
        # email". Scheduled from `_finish_scramble`; even if the server
        # dies before this runs, it runs after restart.
        s = self.state
        if s.phase != ROUND_OVER or s.game_number != request.game_number:
            return
        if s.last_winner:
            await Player.ref(s.last_winner).record_win(
                context,
                amount=s.pot,
            )
            s.payouts += s.pot
            self._log(
                f"💸 Paid {s.pot} coins to {s.last_winner}. "
                "New game forming in the lobby!"
            )
            s.pot = 0
        s.players = []
        s.active = []
        s.chairs = []
        s.eliminated_last = []
        s.round_number = 0
        s.game_number += 1
        s.phase = LOBBY

    async def set_chaos(
        self,
        context: WriterContext,
        request: Game.SetChaosRequest,
    ) -> None:
        self.state.slow_join_ms = request.slow_join_ms
        if request.slow_join_ms > 0:
            self._log(
                f"🌪️ CHAOS: join now takes {request.slow_join_ms}ms"
            )
        else:
            self._log("🌤️ Chaos off: join is fast again")

    async def touch(
        self,
        context: WriterContext,
    ) -> None:
        self.state.version += 1

    async def reset(
        self,
        context: WriterContext,
    ) -> None:
        s = self.state
        s.players = []
        s.active = []
        s.chairs = []
        s.eliminated_last = []
        s.round_number = 0
        s.game_number += 1
        s.phase = LOBBY
        s.unverified_fees = 0
        if s.pot > 0:
            # Burn the orphaned pot and take it off the mint ledger, so
            # a reset is a genuinely clean slate and the books balance.
            self._log(
                f"🧹 Game reset. The house burned the orphaned pot "
                f"({s.pot} coins)."
            )
            s.minted -= s.pot
            s.pot = 0
        else:
            self._log("🧹 Game reset. Clean slate.")

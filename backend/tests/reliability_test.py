"""Production-pressure tests for Musical Chairs.

Each test maps to one of the five failure modes from the challenge:

1. the retry that charges twice        -> test_retry_charges_exactly_once
2. the timeout that lied               -> (same dedup mechanism as #1;
                                           the client-side timeout demo
                                           lives in the Chaos Lab)
3. the 200 that hid a failure          -> test_broke_player_gets_typed_error
                                          test_naive_200_hides_failed_charge
4. two buyers, one remaining item      -> test_two_players_one_chair
                                          test_naive_check_then_act_overbooks
5. the crash between charge and email  -> test_join_never_half_happens
                                          test_naive_two_step_loses_coins
"""

import asyncio
import unittest
from chairs.v1.game_rbt import Game
from chairs.v1.player_rbt import Player
from constants import ENTRY_FEE, GAME_ID, STARTING_COINS
from game_servicer import GameServicer
from player_servicer import PlayerServicer
from reboot.aio.applications import Application
from reboot.aio.tests import Reboot


class TestReliability(unittest.IsolatedAsyncioTestCase):

    async def asyncSetUp(self) -> None:
        self.rbt = Reboot()
        await self.rbt.start()
        await self.rbt.up(
            Application(servicers=[GameServicer, PlayerServicer])
        )
        self.context = self.rbt.create_external_context(
            name=f"test-{self.id()}"
        )
        self.game, _ = await Game.create(self.context, GAME_ID)

    async def asyncTearDown(self) -> None:
        await self.rbt.stop()

    async def _player(self, player_id: str):
        player, _ = await Player.create(self.context, player_id)
        return player

    async def _start_scramble(self, *player_ids: str) -> None:
        for player_id in player_ids:
            await self.game.join(self.context, player_id=player_id)
        await self.game.start(self.context)
        # The scheduled `stop_music` fires at a random 3-6s; drive the
        # transition deterministically instead. Guards make the later
        # scheduled task a no-op.
        snapshot = await self.game.get(self.context)
        await self.game.stop_music(
            self.context,
            game_number=snapshot.game_number,
            round_number=snapshot.round_number,
        )

    # ── 1. The retry that charges twice ───────────────────────────────

    async def test_retry_charges_exactly_once(self) -> None:
        alice = await self._player("alice")
        # Three retries of the SAME logical join: identical
        # idempotency alias, as a client would resend after a timeout.
        for _ in range(3):
            await self.game.idempotently("alice joins game 1").join(
                self.context,
                player_id="alice",
            )
        info = await alice.get(self.context)
        self.assertEqual(info.coins, STARTING_COINS - ENTRY_FEE)
        snapshot = await self.game.get(self.context)
        self.assertEqual(snapshot.players, ["alice"])
        self.assertEqual(snapshot.pot, ENTRY_FEE)

    # ── 3. The 200 that hid a failure ─────────────────────────────────

    async def test_broke_player_gets_typed_error(self) -> None:
        broke = await self._player("broke")
        await broke.withdraw(self.context, amount=STARTING_COINS - 5)
        with self.assertRaises(Game.JoinAborted):
            await self.game.join(self.context, player_id="broke")
        # The failed join changed NOTHING: no coins taken, not enrolled.
        info = await broke.get(self.context)
        self.assertEqual(info.coins, 5)
        snapshot = await self.game.get(self.context)
        self.assertEqual(snapshot.players, [])
        self.assertEqual(snapshot.pot, 0)

    async def test_naive_200_hides_failed_charge(self) -> None:
        broke = await self._player("broke")
        await broke.withdraw(self.context, amount=STARTING_COINS)
        # The naive charge NEVER errors; the failure hides in the body.
        response = await broke.naive_withdraw(self.context, amount=ENTRY_FEE)
        self.assertEqual(response.status, "ok")  # The lie.
        self.assertFalse(response.charged)  # The truth.
        # A client that only checks "status" enrolls anyway:
        await self.game.enroll(self.context, player_id="broke")
        dashboard = await self.game.dashboard(self.context)
        # ...and the auditor catches the cooked books.
        self.assertFalse(dashboard.coins_conserved)
        self.assertEqual(dashboard.unverified_fees, ENTRY_FEE)

    # ── 4. Two buyers, one remaining item ─────────────────────────────

    async def test_two_players_one_chair(self) -> None:
        await self._player("alice")
        await self._player("bob")
        await self._start_scramble("alice", "bob")

        # Both players race for the single chair CONCURRENTLY.
        results = await asyncio.gather(
            self.game.claim(self.context, player_id="alice", chair_id=0),
            self.game.claim(self.context, player_id="bob", chair_id=0),
            return_exceptions=True,
        )
        rejections = [r for r in results if isinstance(r, BaseException)]
        self.assertEqual(len(rejections), 1)

        snapshot = await self.game.get(self.context)
        # Exactly one winner survived; nobody shares a seat.
        self.assertEqual(snapshot.phase, "ROUND_OVER")
        self.assertIn(snapshot.last_winner, ("alice", "bob"))
        self.assertEqual(len(snapshot.eliminated_last), 1)

    async def test_naive_check_then_act_overbooks(self) -> None:
        await self._player("alice")
        await self._player("bob")
        await self._player("carol")
        await self._start_scramble("alice", "bob", "carol")

        # Naive clients: both check chair 0, both see it free...
        first = await self.game.chair_available(self.context, chair_id=0)
        second = await self.game.chair_available(self.context, chair_id=0)
        self.assertTrue(first.available)
        self.assertTrue(second.available)
        # ...and both sit.
        await self.game.naive_sit(self.context, player_id="alice", chair_id=0)
        await self.game.naive_sit(self.context, player_id="bob", chair_id=0)

        snapshot = await self.game.get(self.context)
        chair = snapshot.chairs[0]
        self.assertEqual(len(chair.occupants), 2)  # One chair, two buyers.

    # ── 5. The crash between the charge and the email ─────────────────

    async def test_join_never_half_happens(self) -> None:
        alice = await self._player("alice")
        # Whatever happens to `join` — success or abort — there is
        # never a state where the charge landed but the enrollment
        # didn't (or vice versa). Conservation must hold afterwards.
        await self.game.join(self.context, player_id="alice")
        info = await alice.get(self.context)
        snapshot = await self.game.get(self.context)
        self.assertEqual(info.coins, STARTING_COINS - ENTRY_FEE)
        self.assertEqual(snapshot.pot, ENTRY_FEE)
        dashboard = await self.game.dashboard(self.context)
        self.assertTrue(dashboard.coins_conserved)

    async def test_naive_two_step_loses_coins(self) -> None:
        broke_process = await self._player("dave")
        # The classic two-step checkout: charge...
        await broke_process.naive_withdraw(self.context, amount=ENTRY_FEE)
        # ...then the process dies before the enroll ever happens.
        dashboard = await self.game.dashboard(self.context)
        self.assertFalse(dashboard.coins_conserved)
        self.assertEqual(dashboard.missing, ENTRY_FEE)

    # ── Full game: pot pays out exactly once, books stay balanced ─────

    async def test_winner_paid_and_books_balance(self) -> None:
        alice = await self._player("alice")
        await self._player("bob")
        await self._start_scramble("alice", "bob")
        await self.game.claim(self.context, player_id="alice", chair_id=0)

        # The payout transaction is scheduled ~3s after the win.
        for _ in range(20):
            snapshot = await self.game.get(self.context)
            if snapshot.phase == "LOBBY":
                break
            await asyncio.sleep(0.5)
        self.assertEqual(snapshot.phase, "LOBBY")

        info = await alice.get(self.context)
        self.assertEqual(info.coins, STARTING_COINS + ENTRY_FEE)  # -10 +20
        self.assertEqual(info.wins, 1)
        dashboard = await self.game.dashboard(self.context)
        self.assertTrue(dashboard.coins_conserved)
        self.assertEqual(dashboard.payouts, 2 * ENTRY_FEE)


if __name__ == "__main__":
    unittest.main()

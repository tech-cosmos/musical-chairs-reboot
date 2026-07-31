import asyncio
from chairs.v1.game_rbt import Game
from constants import GAME_ID
from game_servicer import GameServicer
from player_servicer import PlayerServicer
from reboot.aio.applications import Application
from reboot.aio.external import InitializeContext


async def initialize(context: InitializeContext):
    await Game.create(context, GAME_ID)


async def main():
    await Application(
        title="Musical Chairs",
        servicers=[
            GameServicer,
            PlayerServicer,
        ],
        initialize=initialize,
    ).run()


if __name__ == '__main__':
    asyncio.run(main())

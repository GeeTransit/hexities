import copy
import json
import random

import anyio
import fastapi
import fastapi.middleware.cors

app = fastapi.FastAPI()

# Host the frontend
@app.get("/")
async def index_endpoint():
    return fastapi.responses.FileResponse("index.html")

# Set up a simple chat application over WebSockets
sessions: dict[str, fastapi.WebSocket] = {}

def make_catan_game(event):
    nodes = set()
    edges = set()
    for info in event["tiles"]:
        x, y = info["x"], info["y"]
        for dx, dy in neighbours1:
            nodes.add((x + 2*dx, y + 2*dy))
        for dx, dy in neighbours2:
            edges.add((x + dx, y + dy))
    usernames = ["alice", "bob", "carol", "dave"]
    return {
        "user_order": usernames,
        "current_user": usernames[0],
        "current_stage": "roll",
        "nodes": [{"x": x, "y": y} for x, y in nodes],
        "edges": [{"x": x, "y": y} for x, y in edges],
        "tiles": [info for info in event["tiles"]],
        "hands": [{"username": username, "resources": {}} for username in usernames],
        # settlements: {username: [[x,y],...], ...}, same with cities, roads
        # robber: [x,y],
    }

def coord_kind(q, r):
    if q%2 == 0 and r%2 == 0:
        if (q-r)%6 == 0:
            return "hex"
        else:
            return "node"
    elif (q-r)%3 == 0:
        return "edge"
neighbours1 = [(0, 1), (0, -1), (-1, 0), (1, 0), (1, -1), (-1, 1)]
neighbours2 = [(2, -1), (-2, 1), (-1, 2), (1, -2), (-1, -1), (1, 1)]

def find(infos, **kwargs):
    for info in infos:
        for key, value in kwargs.items():
            if info[key] != value:
                break
        else:
            return info
    raise LookupError(f'cannot find {kwargs!r}')

def check_valid_event(event, state, internal=False):  # return clean event
    # if event needs randomized outcome, include random outcome
    if internal and event["type"] == "init":
        assert not state
        Q = V = {(0, 0)}
        for _ in range(2):
            nQ = set()
            for x, y in list(Q):
                for dx, dy in neighbours2:
                    coord = (x + 2*dx, y + 2*dy)
                    if coord not in V:
                        V.add(coord)
                        nQ.add(coord)
            Q = nQ
        assert len(V) == 3+4+5+4+3
        resources = ["brick"]*3 + ["ore"]*3 + ["sheep"]*4 + ["wheat"]*4 + ["wood"]*4 + ["desert"]
        assert len(resources) == len(V)
        random.shuffle(resources)
        placed = {}
        numbers = [2, 12] + [3, 4, 5, 6, 8, 9, 10, 11]*2
        assert len(numbers) == len(V)-1  # skip desert
        random.shuffle(numbers)
        order = list(V)
        random.shuffle(order)
        i = 0
        for number in numbers:
            # get next tile to place
            while resources[i] == "desert" or order[i] in placed:
                i += 1
            x, y = order[i]
            # place non-red numbers immediately
            if number not in (6, 8):
                placed[x, y] = number
            else:
                # if red number (6 or 8), try positions that don't touching other red numbers
                for j in range(i, len(order)):
                    if resources[j] == "desert": continue
                    x, y = order[j]
                    if all(
                        placed.get((x + 2*dx, y + 2*dy)) not in (6, 8)
                        for dx, dy in neighbours2
                    ):
                        placed[x, y] = number
                        break
                else:
                    # if not possible, go backward, swapping when a position is found
                    for j in reversed(range(i)):
                        if resources[j] == "desert": continue
                        x, y = order[j]
                        if placed[x, y] not in (6, 8) and all(
                            placed.get((x + 2*dx, y + 2*dy)) not in (6, 8)
                            for dx, dy in neighbours2
                        ):
                            prev_number = placed[x, y]
                            placed[x, y] = number
                            placed[order[i]] = prev_number
                            break
                    else:
                        assert False
        return {
            "type": "init",
            "tiles": [
                {"x": x, "y": y, "resource": resource, **({"number": placed[x, y]} if (x, y) in placed else {})}
                for (x, y), resource in zip(order, resources)
            ]
            # "ports": [{"y":y,"x":x,"type":"lumber/any"}]
        }
    if event["type"] == "end_turn":
        assert event["username"] == state["current_user"]
        assert state["current_stage"] == "normal"
        return {"type": "end_turn", "username": state["current_user"]}
    if event["type"] == "roll":
        assert event["username"] == state["current_user"]
        assert state["current_stage"] == "roll"
        return {
            "type": "roll",
            "username": state["current_user"],
            "dice_outcome": {
                "first": random.randint(1, 6),
                "second": random.randint(1, 6),
            },
        }
    if event["type"] == "build_road":
        assert event["username"] == state["current_user"]
        assert state["current_stage"] == "normal"
        assert isinstance(event["x"], int)
        assert isinstance(event["y"], int)
        assert coord_kind(event["x"], event["y"]) == "edge"
        info = find(state["edges"], x=event["x"], y=event["y"])
        assert "road" not in info
        return {"type": "build_road", "username": state["current_user"], "x": event["x"], "y": event["y"]}
    if event["type"] == "build_settlement":
        assert event["username"] == state["current_user"]
        assert state["current_stage"] == "normal"
        assert isinstance(event["x"], int)
        assert isinstance(event["y"], int)
        assert coord_kind(event["x"], event["y"]) == "node"
        info = find(state["nodes"], x=event["x"], y=event["y"])
        assert "settlement" not in info
        return {"type": "build_settlement", "username": state["current_user"], "x": event["x"], "y": event["y"]}
    assert False, "unknown event"
def apply_event(event, state):  # return new state
    # check player correct for player specific events
    # check move is correct
    # update game state and recalculate stuff if necessary (ie longest road)
    new_state = copy.deepcopy(state)
    if event["type"] == "init":
        return make_catan_game(event)
        # {
            # "board": {
                # y: {
                    # x: {},
                # },
                # ...
            # },
        # }
    if event["type"] == "end_turn":
        user_order = state["user_order"]
        i = user_order.index(state["current_user"])
        new_state["current_user"] = user_order[(i + 1) % len(user_order)]
        new_state["current_stage"] = "roll"
        return new_state
    if event["type"] == "roll":
        # distribute cards
        number = event["dice_outcome"]["first"] + event["dice_outcome"]["second"]
        for tile in state["tiles"]:
            if tile.get("number") == number:
                x, y = tile["x"], tile["y"]
                for dx, dy in neighbours1:
                    nx, ny = x + 2*dx, y + 2*dy
                    node = find(state["nodes"], x=nx, y=ny)
                    if "settlement" in node:
                        hand_res = find(new_state["hands"], username=node["username"])["resources"]
                        hand_res[tile["resource"]] = hand_res.get(tile["resource"], 0) + 1
        new_state["current_stage"] = "normal"
        return new_state
    if event["type"] == "build_road":
        info = find(new_state["edges"], x=event["x"], y=event["y"])
        info["road"] = True
        info["username"] = event["username"]
        return new_state
    if event["type"] == "build_settlement":
        info = find(new_state["nodes"], x=event["x"], y=event["y"])
        info["settlement"] = True
        info["username"] = event["username"]
        return new_state
    assert False, "unknown event"
    # if event["type"] == "place_settlement":
        # x, y = event["x"], event["y"]
        # new_state.setdefault(x, {}).setdefault(y, {})["settlement"] = 1
def make_personalized_events(username, event):
    # useful for events which have private info like which dev card got drawn
    if "state" in event:
        state = copy.deepcopy(event["state"])
        for hand in state["hands"]:
            if hand["username"] != username:
                total = sum(hand["resources"].values())
                hand["resources"].clear()
                hand["resources"]["unknown"] = total
        event = {**event, "state": state}
    return [event]

def check_valid_and_apply_event(event, state, internal=False):
    event = check_valid_event(event, state, internal=internal)
    state = apply_event(event, state)
    return {**event, "state": state}

# extenal storage (store game state)
# get event, check valid, apply event, broadcast event/game state
# for now theres only one game (stored in a local file)
# and player names hardcoded
events = [check_valid_and_apply_event({"type": "init"}, {}, internal=True)]  # list of {"type": event_type, ..., "state": ...}
events_updated = anyio.Condition()

async def send(ws, event):
    await ws.send_text(json.dumps(event, separators=",:"))

command_handlers = {
    "login": lambda username: {"type": "login", "username": username},
    "roll": lambda: {"type": "roll"},
    "end_turn": lambda: {"type": "end_turn"},
    "logout": lambda: {"type": "logout"},
    "build_road": lambda x, y: {"type": "build_road", "x": int(x), "y": int(y)},
    "build_settlement": lambda x, y: {"type": "build_settlement", "x": int(x), "y": int(y)},
}
def parse_incoming(msg: str):
    if msg.strip().startswith("{"):
        return json.loads(msg)
    import shlex
    name, *args = shlex.split(msg)
    return command_handlers[name](*args)

class HandlerError(ValueError):
    def __init__(self, event):
        self.event = event

async def handle_event(event, session, tg, ws):
    if session.setdefault("state", "login") == "login":
        if event["type"] == "login":
            if "username" not in event:
                raise HandlerError({"type": "login_deny", "reason": "username missing"})
            username = event["username"]
            if username in sessions:
                raise HandlerError({"type": "login_deny", "reason": "given username in use"})
            i = 0
            state = None
            while i < len(events):
                for personalized_event in make_personalized_events(username, events[i]):
                    personalized_event = personalized_event.copy()
                    state = personalized_event.pop("state", state)
                    await send(ws, personalized_event)
                i += 1
            event_index = i
            assert state is not None, "should have state"
            await send(ws, {"type": "game_state", "state": state})
            await send(ws, {"type": "login_accept", "username": username})
            print("yay:", username)
            session["state"] = "game"
            session["username"] = username
            session["outgoing_obj"] = outgoing_obj = object()
            sessions[username] = session
            async def _handle_outgoing_events(i, outgoing_obj):
                while True:
                    while i >= len(events):
                        async with events_updated:
                            await events_updated.wait()
                        if session.get("outgoing_obj") is not outgoing_obj:
                            return
                    for personalized_event in make_personalized_events(username, events[i]):
                        await send(ws, personalized_event)
                    i += 1
            tg.start_soon(_handle_outgoing_events, event_index, outgoing_obj)
            return
    if session["state"] == "game":
        if event["type"] == "logout":
            del sessions[session["username"]]
            session.clear()
            await send(ws, {"type": "logout_accept"})
            return
        if event.setdefault("username", session["username"]) != session["username"]:
            raise RuntimeError("username must match own username")
        new_event = check_valid_and_apply_event(event, events[-1]["state"])
        events.append(new_event)
        async with events_updated:
            events_updated.notify_all()
        return
    raise HandlerError({"type": "debug", "reason": "unknown event"})

@app.websocket("/ws")
async def ws_endpoint(ws: fastapi.WebSocket):
    await ws.accept()
    session = {}
    try:
        async with anyio.create_task_group() as tg:
            @tg.start_soon
            async def _handle_incoming_events():
                while True:
                    try:
                        msg = await ws.receive_text()
                    except fastapi.WebSocketDisconnect as e:
                        tg.cancel_scope.cancel()
                        return
                    try:
                        event = parse_incoming(msg)
                        await handle_event(event, session=session, tg=tg, ws=ws)
                    except HandlerError as e:
                        print(ascii([e, msg]))
                        await send(ws, e.event)
                        continue
                    except Exception as e:
                        print(ascii([msg]))
                        import traceback; traceback.print_exc()
                        await send(ws, {"type": "debug", "reason": "invalid event", "_pyerror": repr(e)})
                        continue
    finally:
        username = session.get("username")
        if sessions.get(username) is session:
            del sessions[username]
            session.clear()
        try:
            await ws.close()
        except RuntimeError:  # happens if the websocket is already closed
            pass

# A frontend should be able to connect to any backend
app.add_middleware(
    fastapi.middleware.cors.CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

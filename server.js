const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const v = require('valibot');
const ws = require('ws');

const server = new http.Server();
const wsserver = new ws.WebSocketServer({ server, path: '/ws' });

function kind(q, r) {
	// 0, 0 is a tile
	if (q%2 == 0 && r%2 == 0) {
		if ((q-r)%6 == 0) {
			return "tile";
		} else {
			return "node";
		}
	} else if ((q-r)%3 == 0) {
		return "edge";
	}
}
const neighbours1 = [[0, 1], [0, -1], [-1, 0], [1, 0], [1, -1], [-1, 1]];
const neighbours2 = [[2, -1], [-2, 1], [-1, 2], [1, -2], [-1, -1], [1, 1]];

// TODO: load and store events to file for persistence
const events = [{ state: {} }];
const filename = 'game-js.jsonl';
try {
	const contents = fs.readFileSync(filename);
	for (const line of contents.split("\n")) {
		const event = JSON.parse(line);
		const state = JSON.parse(JSON.stringify(events.at(-1).state));
		apply(event, state, { internal: true });
		event.state = state;
		events.push(event);
	}
	console.log(`Success loading save file: ${filename}`);
} catch (err) {
	console.error(`Error loading save file: ${filename}`, err);
	const event = {
		type: "init",
		tiles:[{"x":-6,"y":0,"resource":"sheep","number":2},{"x":0,"y":-6,"resource":"sheep","number":6},{"x":4,"y":4,"resource":"wheat","number":5},{"x":-8,"y":4,"resource":"wheat","number":12},{"x":2,"y":-4,"resource":"brick","number":3},{"x":4,"y":-2,"resource":"wheat","number":10},{"x":0,"y":6,"resource":"wood","number":10},{"x":0,"y":0,"resource":"sheep","number":9},{"x":4,"y":-8,"resource":"wood","number":9},{"x":-6,"y":6,"resource":"ore","number":8},{"x":-2,"y":-2,"resource":"brick","number":3},{"x":-2,"y":4,"resource":"desert","robber":true},{"x":-4,"y":8,"resource":"ore","number":11},{"x":-4,"y":-4,"resource":"wood","number":11},{"x":6,"y":-6,"resource":"wheat","number":8},{"x":8,"y":-4,"resource":"wood","number":4},{"x":-4,"y":2,"resource":"ore","number":5},{"x":6,"y":0,"resource":"brick","number":6},{"x":2,"y":2,"resource":"sheep","number":4}],
	};
	const state = JSON.parse(JSON.stringify(events.at(-1).state));
	apply(event, state, { internal: true });
	event.state = state;
	events.push(event);
}
const sessions = new Set();

// TODO: implement game logic
// TODO: write tests

/*
type State = {
	user_order: string[],
	current_user: string,
	current_stage: "roll",
	nodes: {
		x: number,
		y: number,
	}[],
	edges: {
		x: number,
		y: number,
	}[],
	tiles: {
		x: number,
		y: number,
	}[],
	hands: {
		username: string,
		resources: {
			brick?: number,
			ore?: number,
			sheep?: number,
			wheat?: number,
			wood?: number,
			unknown?: number,
		},
		devcards: {
			invention?: number,
			knight?: number,
			monopoly?: number,
			road_building?: number,
			victory_point?: number,
			unknown?: number,
		},
	}[],
	devcards: {
		invention?: number,
		knight?: number,
		monopoly?: number,
		road_building?: number,
		victory_point?: number,
		unknown?: number,
	},
}
type Event = {
	type: "init",
	tiles: {
		x: number,
		y: number,
		resource: "brick" | "ore" | "sheep" | "wheat" | "wood",
		number: number,
	}[],
} | {
	type: "roll",
	username: string,
	dice_outcome: {
		first: number,
		second: number,
	},
} | {
	type: "end_turn",
	username: string,
}
const EventSchema = v.variant('type', [
	v.object({
		type: v.literal('roll'),
		username: v.optional(v.string()),
		dice_outcome: v.optional(v.object({
			first: v.number(),
			second: v.number(),
		})),
	}),
	v.object({
		type: v.literal('end_turn'),
		username: v.optional(v.string()),
	}),
]);
*/

function next(array, value) {
	const i = array.indexOf(value);
	if (i == -1) throw new Error("value not in array");
	return array[(i + 1) % array.length];
}

// function ensureGenerated(obj, key, mustExist, generatorFunc) {
	// if (obj[key] == null) {
		// if (mustExist) {
			// throw new Error(`missing ${key} during internal event loading`);
		// } else {
			// obj[key] = generatorFunc();
		// }
	// }
// }

function apply(event, state, session) {
	// can modify game state and event
	if (event.type == "init") {
		assert(session.internal, "internal event");
		assert.deepEqual(state, {});
		v.assert(v.object({
			type: v.literal("init"),
			tiles: v.array(v.pipe(
				v.object({
					x: v.pipe(v.number(), v.integer()),
					y: v.pipe(v.number(), v.integer()),
					resource: v.pipe(v.string(), v.values(["brick", "ore", "sheep", "wheat", "wood", "desert"])),
					number: v.pipe(v.optional(v.number()), v.values([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])),
					robber: v.optional(v.boolean()),
				}),
				v.check(({ x, y }) => kind(x, y) === "tile", "tile not aligned to hex grid"),
			)),
		}), event);
		/*
		v.assert(v.pipe(
			v.object({
				type: v.literal("init"),
				user_order: v.pipe(
					v.optional(v.array(v.string()), ["alice", "bob", "carol", "dave"]),
					v.check(arr => new Set(arr).size === arr.length, "usernames not unique"),
				),  // should be all unique
				current_user: v.optional(v.string()),  // should be in user_order
				current_stage: v.pipe(
					v.optional(v.string(), "roll"),
					v.values(["roll", "normal"]),
				),
				nodes: v.pipe(
					v.array(v.object({
						x: v.pipe(v.number(), v.integer()),
						y: v.pipe(v.number(), v.integer()),
						username: v.optional(v.string()),
						settlement: v.optional(v.boolean()),
					})),
					v.checkItems(({ x, y }) => kind(x, y) === "tile", "tile not aligned to hex grid"),
				),
				edges: v.pipe(
					v.array(v.object({
						x: v.pipe(v.number(), v.integer()),
						y: v.pipe(v.number(), v.integer()),
						username: v.optional(v.string()),
						road: v.optional(v.boolean()),
					})),
					v.checkItems(({ x, y }) => kind(x, y) === "tile", "tile not aligned to hex grid"),
				),
				tiles: v.pipe(
					v.array(v.object({
						x: v.pipe(v.number(), v.integer()),
						y: v.pipe(v.number(), v.integer()),
						resource: v.pipe(v.string(), v.values(["brick", "ore", "sheep", "wheat", "wood", "desert"])),
						number: v.pipe(v.optional(v.number()), v.values([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))),
						robber: v.optional(v.boolean()),
					}),
					v.checkItems(({ x, y }) => kind(x, y) === "tile", "tile not aligned to hex grid"),
				),
				hands: v.optional(v.array(v.object({
					username: v.string(),
					resources: v.object(v.entriesFromList(
						["brick", "ore", "sheep", "wheat", "wood"],
						v.pipe(v.number(), v.integer(), v.minValue(0)),
					)),
					devcards: v.object(v.entriesFromList(
						["invention", "knight", "monopoly", "road_building", "victory_point"],
						v.pipe(v.number(), v.integer(), v.minValue(0)),
					)),
				}))),
				devcards: v.optional(v.object(v.entriesFromList(
					["invention", "knight", "monopoly", "road_building", "victory_point"],
					v.pipe(v.number(), v.integer(), v.minValue(0)),
				)),
			}),
			v.transform(event => {
				event.current_user ??= event.user_order[0];
			}),
			v.check(event => event.user_order.includes(event.current_user), "current_user not in usernames"),
		)), event);
		*/
		const usernames = ["alice", "bob", "carol", "dave"];
		state.user_order = usernames;
		state.current_user = usernames[0];
		state.current_stage = "roll";
		state.tiles = event.tiles;

		// state.nodes = event.nodes;
		// state.edges = event.edges;
		// state.tiles = event.tiles;

// def make_catan_game(event):
    // nodes = set()
    // edges = set()
    // for info in event["tiles"]:
        // x, y = info["x"], info["y"]
        // for dx, dy in neighbours1:
            // nodes.add((x + 2*dx, y + 2*dy))
        // for dx, dy in neighbours2:
            // edges.add((x + dx, y + dy))
    // # assert all((info["x"], info["y"]) in nodes for info in event["ports"])
    // usernames = ["billy", "rob", "oscar", "walter"]
    // return {
        // "user_order": usernames,
        // "current_user": usernames[0],
        // "current_stage": "roll",
        // "nodes": [{"x": x, "y": y} for x, y in nodes],
        // "edges": [{"x": x, "y": y} for x, y in edges],
        // "tiles": [info for info in event["tiles"]],
        // "hands": [{
            // "username": username,
            // "resources": dict.fromkeys(("brick", "ore", "sheep", "wheat", "wood"), 0),
            // "devcards": dict.fromkeys(("invention", "knight", "monopoly", "road_building", "victory_point"), 0),
        // } for username in usernames],
        // "devcards": {"invention": 2, "knight": 14, "monopoly": 2, "road_building": 2, "victory_point": 5}
        // # settlements: {username: [[x,y],...], ...}, same with cities, roads
        // # robber: [x,y],
    // }


	} else if (event.type == "roll") {
		if (!session.internal) {
			event.username = session.username;
			event.dice_outcome = {
				first: Math.random()*6|0 + 1,
				second: Math.random()*6|0 + 1,
			};
		}
		v.assert(v.object({
			type: v.literal("roll"),
			// ensure event username is same as state's current user
			username: v.pipe(v.string(), v.value(state.current_user)),
			dice_outcome: v.object({
				first: v.pipe(v.number(), v.values([1, 2, 3, 4, 5, 6])),
				second: v.pipe(v.number(), v.values([1, 2, 3, 4, 5, 6])),
			}),
		}), event);
		// ensure state's current stage is roll
		assert.strictEqual(state.current_stage, "roll", "expected roll stage");
		// change stage
		state.current_stage = "normal";
		// distribute resources matching number rolled
		// TODO: do this
	} else if (event.type == "end_turn") {
		if (!session.internal) {
			event.username = session.username;
		}
		v.assert(v.object({
			type: v.literal("end_turn"),
			// ensure event username is same as state's current user
			username: v.pipe(v.string(), v.value(state.current_user)),
		}), event);
		// ensure state's current stage is normal
		assert.strictEqual(state.current_stage, "normal", "expected normal stage");
		// change stage
		state.current_stage = "roll";
		// go to next player
		state.current_user = next(state.user_order, event.username);
		// TODO: do this
	} else {
		assert.fail("unknown event type");
	}
}
// presto case number refund monthly pass for blocked card
// cas431144g8g6105
// within 5 business days

// 786674968

/*
def make_catan_game(event):
    nodes = set()
    edges = set()
    for info in event["tiles"]:
        x, y = info["x"], info["y"]
        for dx, dy in neighbours1:
            nodes.add((x + 2*dx, y + 2*dy))
        for dx, dy in neighbours2:
            edges.add((x + dx, y + dy))
    # assert all((info["x"], info["y"]) in nodes for info in event["ports"])
    usernames = ["billy", "rob", "oscar", "walter"]
    return {
        "user_order": usernames,
        "current_user": usernames[0],
        "current_stage": "roll",
        "nodes": [{"x": x, "y": y} for x, y in nodes],
        "edges": [{"x": x, "y": y} for x, y in edges],
        "tiles": [info for info in event["tiles"]],
        "hands": [{
            "username": username,
            "resources": dict.fromkeys(("brick", "ore", "sheep", "wheat", "wood"), 0),
            "devcards": dict.fromkeys(("invention", "knight", "monopoly", "road_building", "victory_point"), 0),
        } for username in usernames],
        "devcards": {"invention": 2, "knight": 14, "monopoly": 2, "road_building": 2, "victory_point": 5}
        # settlements: {username: [[x,y],...], ...}, same with cities, roads
        # robber: [x,y],
    }
*/

/*
{"type":"init","tiles":[{"x":-6,"y":0,"resource":"sheep","number":2},{"x":0,"y":-6,"resource":"sheep","number":6},{"x":4,"y":4,"resource":"wheat","number":5},{"x":-8,"y":4,"resource":"wheat","number":12},{"x":2,"y":-4,"resource":"brick","number":3},{"x":4,"y":-2,"resource":"wheat","number":10},{"x":0,"y":6,"resource":"wood","number":10},{"x":0,"y":0,"resource":"sheep","number":9},{"x":4,"y":-8,"resource":"wood","number":9},{"x":-6,"y":6,"resource":"ore","number":8},{"x":-2,"y":-2,"resource":"brick","number":3},{"x":-2,"y":4,"resource":"desert","robber":true},{"x":-4,"y":8,"resource":"ore","number":11},{"x":-4,"y":-4,"resource":"wood","number":11},{"x":6,"y":-6,"resource":"wheat","number":8},{"x":8,"y":-4,"resource":"wood","number":4},{"x":-4,"y":2,"resource":"ore","number":5},{"x":6,"y":0,"resource":"brick","number":6},{"x":2,"y":2,"resource":"sheep","number":4}]}
{"type":"roll","username":"billy","dice_outcome":{"first":5,"second":2}}
{"type":"build_settlement","username":"billy","x":6,"y":-2}
{"type":"build_settlement","username":"billy","x":-2,"y":0}
{"type":"end_turn","username":"billy"}
{"type":"roll","username":"rob","dice_outcome":{"first":5,"second":2}}
{"type":"build_settlement","username":"rob","x":4,"y":-4}
{"type":"build_settlement","username":"rob","x":-6,"y":2}
{"type":"end_turn","username":"rob"}
{"type":"roll","username":"oscar","dice_outcome":{"first":3,"second":4}}
{"type":"build_settlement","username":"oscar","x":-2,"y":-4}
{"type":"build_settlement","username":"oscar","x":-8,"y":6}
{"type":"end_turn","username":"oscar"}
{"type":"roll","username":"walter","dice_outcome":{"first":5,"second":6}}
{"type":"build_settlement","username":"walter","x":2,"y":4}
{"type":"build_settlement","username":"walter","x":-2,"y":6}
{"type":"end_turn","username":"walter"}
{"type":"roll","username":"billy","dice_outcome":{"first":4,"second":5}}
{"type":"activate_robber","username":"billy","target_user":"oscar","x":-2,"y":-2,"resource":"wood"}
{"type":"end_turn","username":"billy"}
{"type":"roll","username":"rob","dice_outcome":{"first":3,"second":6}}
*/

function broadcast(event) {
	console.log(JSON.stringify({ ...event, state: undefined }));
  for (const session of sessions) {
    try {
      // TODO: personalize events
      session.ws.send(JSON.stringify(event));
    } catch (err) {
      console.error({ err, event, session });
    }
  }
}

wsserver.on('connection', ws => {
  const session = { ws, state: "login" };
  ws.on('message', data => {
    console.log({ data: data.toString(), session });
    try {
			const event = JSON.parse(data);
			if (session.state == "login") {
				if (event.type == "login") {
					// ensure user isnt already in sessions
					assert(![...sessions.values()].some(({ username }) => username == event.username), "username already connected");
					session.username = event.username;
					session.state = "game";
          ws.send(JSON.stringify({
						type: "game_state",
						state: events.at(-1).state,
					}));
          ws.send(JSON.stringify({
						type: "login_accept",
						username: session.username,
					}));
					sessions.add(session);
				} else {
					assert.fail("unknown event type");
				}
			} else if (session.state == "game") {
				if (event.type == "logout") {
					sessions.delete(session);
					session.state = "login";
					ws.send(JSON.stringify({ type: "logout_accept" }));
				} else {
					const state = JSON.parse(JSON.stringify(events.at(-1).state));
					apply(event, state, session);
					event.state = state;
					events.push(event);
					broadcast(event);
				}
			} else {
				assert.fail("unknown session state");
			}
    } catch (err) {
			console.error(err);
      ws.send(JSON.stringify({
        type: "debug",
        reason: "invalid event",
        _jserror: err.toString(),
      }));
    } finally {
      return;
    }
  });
  ws.on('error', err => {
    console.error({ err });
  });
  ws.on('close', () => {
    sessions.delete(session);
  });
});

server.on('request', (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/html",
  });
  fs.createReadStream('index.html').pipe(res);
});

const port = 8080;
server.listen(port);
console.log(`Server started on port ${port}`);

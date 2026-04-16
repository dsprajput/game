import json
import os
import random
import secrets
import sqlite3
import threading
import time
from collections import defaultdict, deque
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("DB_PATH", str(ROOT / "game.db")))
DEFAULT_CARD_TYPES = ["Ram", "Laxman", "Sita", "Hanuman", "Bharat", "Shatrughna"]
STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "application/javascript; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/robots.txt": ("robots.txt", "text/plain; charset=utf-8"),
    "/sitemap.xml": ("sitemap.xml", "application/xml; charset=utf-8"),
}
ROOM_WAITING_TTL_SECONDS = 24 * 60 * 60
ROOM_FINISHED_TTL_SECONDS = 6 * 60 * 60
RATE_LIMIT_WINDOW_SECONDS = 60
RATE_LIMIT_MAX_REQUESTS = 240


db_lock = threading.Lock()
rate_limit_lock = threading.Lock()
request_log = defaultdict(deque)


def db_connection():
    connection = sqlite3.connect(DB_PATH, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    return connection


CONN = db_connection()


def init_db():
    with CONN:
        CONN.execute(
            """
            CREATE TABLE IF NOT EXISTS rooms (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                player_count INTEGER NOT NULL,
                bot_count INTEGER NOT NULL DEFAULT 0,
                card_types_json TEXT NOT NULL,
                starter_index INTEGER NOT NULL DEFAULT 0,
                active_player_index INTEGER NOT NULL DEFAULT 0,
                turn_count INTEGER NOT NULL DEFAULT 0,
                winner_player_id TEXT,
                winner_type TEXT,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            )
            """
        )
        CONN.execute(
            """
            CREATE TABLE IF NOT EXISTS players (
                id TEXT PRIMARY KEY,
                room_id TEXT NOT NULL,
                name TEXT NOT NULL,
                session_token TEXT NOT NULL UNIQUE,
                seat_index INTEGER NOT NULL,
                is_bot INTEGER NOT NULL DEFAULT 0,
                score INTEGER NOT NULL DEFAULT 0,
                hand_json TEXT NOT NULL DEFAULT '[]',
                joined_at REAL NOT NULL,
                last_seen_at REAL NOT NULL,
                FOREIGN KEY (room_id) REFERENCES rooms(id)
            )
            """
        )
        CONN.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                room_id TEXT NOT NULL,
                player_id TEXT NOT NULL,
                player_name TEXT NOT NULL,
                text TEXT NOT NULL DEFAULT '',
                emoji TEXT NOT NULL DEFAULT '',
                reaction TEXT NOT NULL DEFAULT 'message',
                created_at REAL NOT NULL,
                FOREIGN KEY (room_id) REFERENCES rooms(id),
                FOREIGN KEY (player_id) REFERENCES players(id)
            )
            """
        )
        player_columns = [row["name"] for row in CONN.execute("PRAGMA table_info(players)").fetchall()]
        if "score" not in player_columns:
            CONN.execute("ALTER TABLE players ADD COLUMN score INTEGER NOT NULL DEFAULT 0")
        if "is_bot" not in player_columns:
            CONN.execute("ALTER TABLE players ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0")
        room_columns = [row["name"] for row in CONN.execute("PRAGMA table_info(rooms)").fetchall()]
        if "bot_count" not in room_columns:
            CONN.execute("ALTER TABLE rooms ADD COLUMN bot_count INTEGER NOT NULL DEFAULT 0")


def now_ts():
    return time.time()


def random_code(length=6):
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(random.choice(alphabet) for _ in range(length))


def random_id(length=12):
    alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
    return "".join(random.choice(alphabet) for _ in range(length))


def random_token():
    return secrets.token_urlsafe(24)


def parse_card_types(items):
    cleaned = []
    for item in items:
        value = str(item).strip()
        if value and len(value) <= 32:
            cleaned.append(value)
    return cleaned or list(DEFAULT_CARD_TYPES)


def normalize_player_name(value):
    return str(value).strip()[:24]


def normalize_bot_count(value):
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


def build_deck(card_types):
    deck = []
    for index, card_type in enumerate(card_types):
        copies = 5 if index == 0 else 4
        for card_index in range(copies):
            deck.append({
                "id": f"{card_type}-{card_index + 1}",
                "type": card_type,
            })
    return deck


def count_types(hand):
    counts = {}
    for card in hand:
        counts[card["type"]] = counts.get(card["type"], 0) + 1
    return counts


def has_four_of_a_kind(hand):
    return any(total >= 4 for total in count_types(hand).values())


def most_common_type(hand):
    counts = count_types(hand)
    return sorted(counts.items(), key=lambda item: item[1], reverse=True)[0][0]


def summarize_hand(hand):
    counts = count_types(hand)
    if not counts:
        return "No cards"
    _, best_count = sorted(counts.items(), key=lambda item: item[1], reverse=True)[0]
    return f"Best group: {best_count} matching card" + ("s" if best_count > 1 else "")


def human_slots(room):
    return room["player_count"] - room["bot_count"]


def human_player_count(players):
    return sum(1 for player in players if not player["is_bot"])


def choose_bot_card(hand):
    counts = count_types(hand)
    ranked_cards = sorted(hand, key=lambda card: (counts[card["type"]], card["type"], card["id"]))
    return ranked_cards[0]


def insert_bot_players(room_id, player_count, bot_count, timestamp):
    if bot_count <= 0:
        return

    first_bot_seat = player_count - bot_count
    for offset in range(bot_count):
        seat_index = first_bot_seat + offset
        CONN.execute(
            """
            INSERT INTO players (id, room_id, name, session_token, seat_index, is_bot, hand_json, joined_at, last_seen_at)
            VALUES (?, ?, ?, ?, ?, 1, '[]', ?, ?)
            """,
            (random_id(), room_id, f"Computer {offset + 1}", random_token(), seat_index, timestamp, timestamp),
        )


def deal_hands(player_count, card_types, starter_index):
    hand_sizes = [5 if index == starter_index else 4 for index in range(player_count)]

    for _ in range(300):
        deck = build_deck(card_types)
        random.shuffle(deck)
        hands = []
        cursor = 0
        for hand_size in hand_sizes:
            hands.append(deck[cursor:cursor + hand_size])
            cursor += hand_size
        if not any(has_four_of_a_kind(hand) for hand in hands):
            return hands

    raise ValueError("Could not create a fair opening deal.")


def room_invite_url(handler, room_id):
    forwarded_proto = handler.headers.get("X-Forwarded-Proto")
    forwarded_host = handler.headers.get("X-Forwarded-Host")
    host = forwarded_host or handler.headers.get("Host", "localhost:8000")
    scheme = forwarded_proto or ("https" if host and ":443" in host else "http")
    return f"{scheme}://{host}/?room={room_id}"


def client_ip(handler):
    forwarded_for = handler.headers.get("X-Forwarded-For", "")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return handler.client_address[0]


def rate_limited(ip_address):
    current = now_ts()
    with rate_limit_lock:
        entries = request_log[ip_address]
        while entries and current - entries[0] > RATE_LIMIT_WINDOW_SECONDS:
            entries.popleft()
        if len(entries) >= RATE_LIMIT_MAX_REQUESTS:
            return True
        entries.append(current)
    return False


def cleanup_expired_rooms():
    current = now_ts()
    waiting_cutoff = current - ROOM_WAITING_TTL_SECONDS
    finished_cutoff = current - ROOM_FINISHED_TTL_SECONDS

    with CONN:
        room_ids = [
            row["id"]
            for row in CONN.execute(
                """
                SELECT id FROM rooms
                WHERE (status = 'waiting' AND updated_at < ?)
                   OR (status = 'finished' AND updated_at < ?)
                """,
                (waiting_cutoff, finished_cutoff),
            ).fetchall()
        ]
        if room_ids:
            CONN.executemany("DELETE FROM players WHERE room_id = ?", [(room_id,) for room_id in room_ids])
            CONN.executemany("DELETE FROM rooms WHERE id = ?", [(room_id,) for room_id in room_ids])


def read_json(handler):
    length = int(handler.headers.get("Content-Length", "0"))
    raw = handler.rfile.read(length) if length else b"{}"
    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        raise ValueError("Invalid JSON payload.")


def get_room(room_id):
    room = CONN.execute("SELECT * FROM rooms WHERE id = ?", (room_id,)).fetchone()
    if room is None:
        return None
    players = CONN.execute(
        "SELECT * FROM players WHERE room_id = ? ORDER BY seat_index ASC",
        (room_id,),
    ).fetchall()
    return room, players


def get_room_messages(room_id, limit=30):
    rows = CONN.execute(
        """
        SELECT * FROM messages
        WHERE room_id = ?
        ORDER BY id DESC
        LIMIT ?
        """,
        (room_id, limit),
    ).fetchall()
    return list(reversed(rows))


def format_message(row):
    created_at = time.localtime(row["created_at"])
    reaction_map = {
        "message": "Message",
        "laughter": "laughed",
        "sad": "felt sad",
        "angry": "got angry",
        "clap": "clapped",
    }
    return {
        "id": row["id"],
        "playerId": row["player_id"],
        "playerName": row["player_name"],
        "text": row["text"],
        "emoji": row["emoji"],
        "reaction": row["reaction"],
        "reactionLabel": reaction_map.get(row["reaction"], "reacted"),
        "timeLabel": time.strftime("%H:%M", created_at),
    }


def serialize_room(room, players, current_player, handler):
    messages = [format_message(row) for row in get_room_messages(room["id"])]
    public_players = []
    for player in players:
        hand = json.loads(player["hand_json"])
        public_player = {
            "id": player["id"],
            "name": player["name"],
            "isBot": bool(player["is_bot"]),
            "score": player["score"],
            "cardCount": len(hand),
            "handSummary": (
                "Computer hand hidden" if player["is_bot"] and room["status"] != "finished"
                else "Hand hidden" if player["id"] != current_player["id"] and room["status"] != "finished"
                else summarize_hand(hand)
            ),
        }
        if player["id"] == current_player["id"]:
            public_player["hand"] = hand
        public_players.append(public_player)

    winner = None
    if room["winner_player_id"]:
        winner_player = next(player for player in players if player["id"] == room["winner_player_id"])
        winner = {
            "id": winner_player["id"],
            "name": winner_player["name"],
            "type": room["winner_type"],
        }

    current_index = next(index for index, player in enumerate(players) if player["id"] == current_player["id"])
    return {
        "roomId": room["id"],
        "status": room["status"],
        "playerCount": room["player_count"],
        "botCount": room["bot_count"],
        "humanCount": human_slots(room),
        "cardTypes": json.loads(room["card_types_json"]),
        "players": public_players,
        "self": public_players[current_index],
        "starterIndex": room["starter_index"],
        "activePlayerIndex": room["active_player_index"],
        "turnCount": room["turn_count"],
        "winner": winner,
        "messages": messages,
        "inviteUrl": room_invite_url(handler, room["id"]),
        "serverTime": int(now_ts()),
    }


def start_room_if_ready(room_id):
    room, players = get_room(room_id)
    if room is None or room["status"] != "waiting" or human_player_count(players) < human_slots(room):
        return

    card_types = json.loads(room["card_types_json"])
    starter_index = random.randrange(room["player_count"])
    hands = deal_hands(room["player_count"], card_types, starter_index)
    updated_at = now_ts()

    with CONN:
        for player, hand in zip(players, hands):
            CONN.execute(
                "UPDATE players SET hand_json = ?, last_seen_at = ? WHERE id = ?",
                (json.dumps(hand), updated_at, player["id"]),
            )
        CONN.execute(
            """
            UPDATE rooms
            SET status = 'playing',
                starter_index = ?,
                active_player_index = ?,
                turn_count = 1,
                winner_player_id = NULL,
                winner_type = NULL,
                updated_at = ?
            WHERE id = ?
            """,
            (starter_index, starter_index, updated_at, room_id),
        )
    advance_bot_turns(room_id)


def restart_room(room_id):
    room_bundle = get_room(room_id)
    if room_bundle is None:
        return None

    room, players = room_bundle
    card_types = json.loads(room["card_types_json"])
    starter_index = random.randrange(room["player_count"])
    hands = deal_hands(room["player_count"], card_types, starter_index)
    updated_at = now_ts()

    with CONN:
        for player, hand in zip(players, hands):
            CONN.execute(
                "UPDATE players SET hand_json = ?, last_seen_at = ? WHERE id = ?",
                (json.dumps(hand), updated_at, player["id"]),
            )
        CONN.execute(
            """
            UPDATE rooms
            SET status = 'playing',
                starter_index = ?,
                active_player_index = ?,
                turn_count = 1,
                winner_player_id = NULL,
                winner_type = NULL,
                updated_at = ?
            WHERE id = ?
            """,
            (starter_index, starter_index, updated_at, room_id),
        )
    return advance_bot_turns(room_id)


def resolve_turn(room_id, room, players, acting_player, card_id):
    hand = json.loads(acting_player["hand_json"])
    card_index = next((index for index, card in enumerate(hand) if card["id"] == card_id), -1)
    if card_index == -1:
        raise ValueError("Card not found in your hand.")

    next_index = (room["active_player_index"] + 1) % len(players)
    next_player = players[next_index]
    next_hand = json.loads(next_player["hand_json"])

    card = hand.pop(card_index)
    next_hand.append(card)

    winner_player_id = None
    winner_type = None
    candidate_hands = {player["id"]: json.loads(player["hand_json"]) for player in players}
    candidate_hands[acting_player["id"]] = hand
    candidate_hands[next_player["id"]] = next_hand

    for room_player in players:
        candidate_hand = candidate_hands[room_player["id"]]
        if has_four_of_a_kind(candidate_hand):
            winner_player_id = room_player["id"]
            winner_type = most_common_type(candidate_hand)
            break

    updated_at = now_ts()
    with CONN:
        CONN.execute(
            "UPDATE players SET hand_json = ?, last_seen_at = ? WHERE id = ?",
            (json.dumps(hand), updated_at, acting_player["id"]),
        )
        CONN.execute(
            "UPDATE players SET hand_json = ?, last_seen_at = ? WHERE id = ?",
            (json.dumps(next_hand), updated_at, next_player["id"]),
        )
        if winner_player_id:
            CONN.execute(
                "UPDATE players SET score = score + 1 WHERE id = ?",
                (winner_player_id,),
            )
            CONN.execute(
                """
                UPDATE rooms
                SET status = 'finished',
                    winner_player_id = ?,
                    winner_type = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (winner_player_id, winner_type, updated_at, room_id),
            )
        else:
            CONN.execute(
                """
                UPDATE rooms
                SET active_player_index = ?, turn_count = turn_count + 1, updated_at = ?
                WHERE id = ?
                """,
                (next_index, updated_at, room_id),
            )


def advance_bot_turns(room_id):
    while True:
        room_bundle = get_room(room_id)
        if room_bundle is None:
            return None

        room, players = room_bundle
        if room["status"] != "playing":
            return room_bundle

        active_player = players[room["active_player_index"]]
        if not active_player["is_bot"]:
            return room_bundle

        hand = json.loads(active_player["hand_json"])
        chosen_card = choose_bot_card(hand)
        resolve_turn(room_id, room, players, active_player, chosen_card["id"])


def authenticated_player(handler, room_id):
    token = handler.headers.get("X-Player-Token", "").strip()
    if not token:
        return None, "Missing player token."

    player = CONN.execute(
        "SELECT * FROM players WHERE room_id = ? AND session_token = ?",
        (room_id, token),
    ).fetchone()
    if player is None:
        return None, "Your saved session is no longer valid for this room."

    with CONN:
        CONN.execute("UPDATE players SET last_seen_at = ? WHERE id = ?", (now_ts(), player["id"]))
    return player, None


def player_response(handler, room_row, player_row):
    return {
        "roomId": room_row["id"],
        "playerId": player_row["id"],
        "playerToken": player_row["session_token"],
        "playerCount": room_row["player_count"],
        "botCount": room_row["bot_count"],
        "humanCount": room_row["player_count"] - room_row["bot_count"],
        "cardTypes": json.loads(room_row["card_types_json"]),
        "inviteUrl": room_invite_url(handler, room_row["id"]),
    }


class GameHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if rate_limited(client_ip(self)):
            return self.send_json({"error": "Too many requests. Please slow down."}, HTTPStatus.TOO_MANY_REQUESTS)

        cleanup_expired_rooms()
        parsed = urlparse(self.path)

        if parsed.path == "/health":
            return self.send_json({"ok": True, "status": "healthy"})

        if parsed.path.startswith("/api/rooms/") and parsed.path.endswith("/state"):
            parts = parsed.path.strip("/").split("/")
            if len(parts) >= 4:
                return self.handle_get_room_state(parts[2])

        if parsed.path in STATIC_FILES:
            filename, content_type = STATIC_FILES[parsed.path]
            return self.serve_file(filename, content_type)

        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self):
        if rate_limited(client_ip(self)):
            return self.send_json({"error": "Too many requests. Please slow down."}, HTTPStatus.TOO_MANY_REQUESTS)

        cleanup_expired_rooms()
        parsed = urlparse(self.path)

        if parsed.path == "/api/rooms":
            return self.handle_create_room()

        if parsed.path.startswith("/api/rooms/") and parsed.path.endswith("/join"):
            parts = parsed.path.strip("/").split("/")
            if len(parts) >= 4:
                return self.handle_join_room(parts[2])

        if parsed.path.startswith("/api/rooms/") and parsed.path.endswith("/pass"):
            parts = parsed.path.strip("/").split("/")
            if len(parts) >= 4:
                return self.handle_pass_card(parts[2])

        if parsed.path.startswith("/api/rooms/") and parsed.path.endswith("/replay"):
            parts = parsed.path.strip("/").split("/")
            if len(parts) >= 4:
                return self.handle_replay_room(parts[2])

        if parsed.path.startswith("/api/rooms/") and parsed.path.endswith("/messages"):
            parts = parsed.path.strip("/").split("/")
            if len(parts) >= 4:
                return self.handle_room_message(parts[2])

        self.send_error(HTTPStatus.NOT_FOUND)

    def serve_file(self, filename, content_type):
        file_path = ROOT / filename
        if not file_path.exists():
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        content = file_path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "public, max-age=300")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(content)

    def handle_create_room(self):
        try:
            payload = read_json(self)
        except ValueError as error:
            return self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)

        player_name = normalize_player_name(payload.get("playerName", ""))
        player_count = int(payload.get("playerCount", 0))
        bot_count = normalize_bot_count(payload.get("botCount", 0))
        card_types = parse_card_types(payload.get("cardTypes", []))

        if not player_name:
            return self.send_json({"error": "Player name is required."}, HTTPStatus.BAD_REQUEST)
        if player_count < 3 or player_count > 6:
            return self.send_json({"error": "Choose between 3 and 6 players."}, HTTPStatus.BAD_REQUEST)
        if bot_count > player_count - 1:
            return self.send_json({"error": "Keep at least one human player in the room."}, HTTPStatus.BAD_REQUEST)
        if len(card_types) < player_count:
            return self.send_json({"error": "Need at least as many card types as players."}, HTTPStatus.BAD_REQUEST)

        room_id = random_code()
        with db_lock:
            while CONN.execute("SELECT 1 FROM rooms WHERE id = ?", (room_id,)).fetchone():
                room_id = random_code()

            player_id = random_id()
            session_token = random_token()
            timestamp = now_ts()
            with CONN:
                CONN.execute(
                    """
                    INSERT INTO rooms (
                        id, status, player_count, bot_count, card_types_json, starter_index, active_player_index,
                        turn_count, winner_player_id, winner_type, created_at, updated_at
                    ) VALUES (?, 'waiting', ?, ?, ?, 0, 0, 0, NULL, NULL, ?, ?)
                    """,
                    (room_id, player_count, bot_count, json.dumps(card_types[:player_count]), timestamp, timestamp),
                )
                CONN.execute(
                    """
                    INSERT INTO players (id, room_id, name, session_token, seat_index, is_bot, hand_json, joined_at, last_seen_at)
                    VALUES (?, ?, ?, ?, 0, 0, '[]', ?, ?)
                    """,
                    (player_id, room_id, player_name, session_token, timestamp, timestamp),
                )
                insert_bot_players(room_id, player_count, bot_count, timestamp)
            start_room_if_ready(room_id)

        self.send_json({
            "roomId": room_id,
            "playerId": player_id,
            "playerToken": session_token,
            "playerCount": player_count,
            "botCount": bot_count,
            "humanCount": player_count - bot_count,
            "inviteUrl": room_invite_url(self, room_id),
        })

    def handle_join_room(self, room_id):
        try:
            payload = read_json(self)
        except ValueError as error:
            return self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)

        player_name = normalize_player_name(payload.get("playerName", ""))
        if not player_name:
            return self.send_json({"error": "Player name is required."}, HTTPStatus.BAD_REQUEST)

        with db_lock:
            room_bundle = get_room(room_id)
            if room_bundle is None:
                return self.send_json({"error": "Room not found."}, HTTPStatus.NOT_FOUND)

            room, players = room_bundle
            existing_player, _ = authenticated_player(self, room_id)
            if existing_player is not None:
                return self.send_json(player_response(self, room, existing_player))
            if room["status"] != "waiting":
                return self.send_json({"error": "This room has already started."}, HTTPStatus.BAD_REQUEST)
            if human_player_count(players) >= human_slots(room):
                return self.send_json({"error": "This room is already full."}, HTTPStatus.BAD_REQUEST)
            if any(player["name"].strip().lower() == player_name.lower() for player in players):
                return self.send_json({"error": "That name is already taken in this room."}, HTTPStatus.BAD_REQUEST)

            player_id = random_id()
            session_token = random_token()
            used_human_seats = {player["seat_index"] for player in players if not player["is_bot"]}
            seat_index = next(
                (index for index in range(human_slots(room)) if index not in used_human_seats),
                None,
            )
            if seat_index is None:
                return self.send_json({"error": "This room is already full."}, HTTPStatus.BAD_REQUEST)
            timestamp = now_ts()
            with CONN:
                CONN.execute(
                    """
                    INSERT INTO players (id, room_id, name, session_token, seat_index, is_bot, hand_json, joined_at, last_seen_at)
                    VALUES (?, ?, ?, ?, ?, 0, '[]', ?, ?)
                    """,
                    (player_id, room_id, player_name, session_token, seat_index, timestamp, timestamp),
                )
                CONN.execute("UPDATE rooms SET updated_at = ? WHERE id = ?", (timestamp, room_id))
            start_room_if_ready(room_id)

        room_row = CONN.execute("SELECT * FROM rooms WHERE id = ?", (room_id,)).fetchone()
        player_row = CONN.execute("SELECT * FROM players WHERE id = ?", (player_id,)).fetchone()
        self.send_json(player_response(self, room_row, player_row))

    def handle_get_room_state(self, room_id):
        with db_lock:
            room_bundle = get_room(room_id)
            if room_bundle is None:
                return self.send_json({"error": "Room not found."}, HTTPStatus.NOT_FOUND)

            player, error = authenticated_player(self, room_id)
            if error:
                return self.send_json({"error": error}, HTTPStatus.FORBIDDEN)

            room, players = advance_bot_turns(room_id)
            payload = serialize_room(room, players, player, self)

        self.send_json(payload)

    def handle_pass_card(self, room_id):
        try:
            payload = read_json(self)
        except ValueError as error:
            return self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)

        card_id = str(payload.get("cardId", "")).strip()
        if not card_id:
            return self.send_json({"error": "Card is required."}, HTTPStatus.BAD_REQUEST)

        with db_lock:
            room_bundle = get_room(room_id)
            if room_bundle is None:
                return self.send_json({"error": "Room not found."}, HTTPStatus.NOT_FOUND)

            room, players = room_bundle
            player, error = authenticated_player(self, room_id)
            if error:
                return self.send_json({"error": error}, HTTPStatus.FORBIDDEN)
            if room["status"] != "playing":
                return self.send_json({"error": "Game is not active."}, HTTPStatus.BAD_REQUEST)

            active_player = players[room["active_player_index"]]
            if active_player["id"] != player["id"]:
                return self.send_json({"error": "It is not your turn."}, HTTPStatus.BAD_REQUEST)
            try:
                resolve_turn(room_id, room, players, player, card_id)
            except ValueError as error:
                return self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)

            updated_room, updated_players = advance_bot_turns(room_id)
            current_player = next(row for row in updated_players if row["id"] == player["id"])
            response = serialize_room(updated_room, updated_players, current_player, self)

        self.send_json(response)

    def handle_replay_room(self, room_id):
        with db_lock:
            room_bundle = get_room(room_id)
            if room_bundle is None:
                return self.send_json({"error": "Room not found."}, HTTPStatus.NOT_FOUND)

            room, players = room_bundle
            player, error = authenticated_player(self, room_id)
            if error:
                return self.send_json({"error": error}, HTTPStatus.FORBIDDEN)
            if room["status"] != "finished":
                return self.send_json({"error": "You can replay only after the round ends."}, HTTPStatus.BAD_REQUEST)
            if human_player_count(players) < human_slots(room):
                return self.send_json({"error": "Room is missing players for a new round."}, HTTPStatus.BAD_REQUEST)

            updated_room, updated_players = restart_room(room_id)
            current_player = next(row for row in updated_players if row["id"] == player["id"])
            response = serialize_room(updated_room, updated_players, current_player, self)

        self.send_json(response)

    def handle_room_message(self, room_id):
        try:
            payload = read_json(self)
        except ValueError as error:
            return self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)

        text = str(payload.get("text", "")).strip()[:120]
        emoji = str(payload.get("emoji", "")).strip()[:8]
        reaction = str(payload.get("reaction", "message")).strip()[:20] or "message"

        if not text and not emoji:
            return self.send_json({"error": "Message is empty."}, HTTPStatus.BAD_REQUEST)

        with db_lock:
            room_bundle = get_room(room_id)
            if room_bundle is None:
                return self.send_json({"error": "Room not found."}, HTTPStatus.NOT_FOUND)

            room, players = room_bundle
            player, error = authenticated_player(self, room_id)
            if error:
                return self.send_json({"error": error}, HTTPStatus.FORBIDDEN)

            updated_at = now_ts()
            with CONN:
                CONN.execute(
                    """
                    INSERT INTO messages (room_id, player_id, player_name, text, emoji, reaction, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (room_id, player["id"], player["name"], text, emoji, reaction, updated_at),
                )
                CONN.execute("UPDATE rooms SET updated_at = ? WHERE id = ?", (updated_at, room_id))

            updated_room, updated_players = get_room(room_id)
            current_player = next(row for row in updated_players if row["id"] == player["id"])
            response = serialize_room(updated_room, updated_players, current_player, self)

        self.send_json(response)

    def send_json(self, payload, status=HTTPStatus.OK):
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format, *args):
        return


def main():
    init_db()
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), GameHandler)
    print(f"Serving Four of a Kind at http://localhost:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()

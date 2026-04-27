const defaultCardTypes = ["Ram", "Laxman", "Sita", "Hanuman", "Bharat", "Shatrughna"];
const ROOM_STORAGE_KEY = "four-of-a-kind-room-players";
const THEME_STORAGE_KEY = "dhup-theme";
const COMPUTER_TURN_DELAY_MS = 3000;
let audioContext = null;
const cardArtMap = {
  ram: { icon: "🏹", aura: "sun", figure: "Royal archer prince" },
  laxman: { icon: "🛡️", aura: "forest", figure: "Loyal warrior prince" },
  sita: { icon: "🌸", aura: "lotus", figure: "Graceful queen figure" },
  hanuman: { icon: "🪔", aura: "ember", figure: "Devoted hero figure" },
  bharat: { icon: "👑", aura: "royal", figure: "Noble prince figure" },
  shatrughna: { icon: "⚔️", aura: "storm", figure: "Swift warrior figure" },
};

const state = {
  mode: "local",
  players: [],
  starterIndex: 0,
  activePlayerIndex: 0,
  turnCount: 0,
  winner: null,
  scores: {},
  handRevealed: false,
  gameMode: "local",
  computerTimer: null,
  remote: {
    roomId: null,
    playerId: null,
    playerToken: null,
    playerName: "",
    inviteUrl: "",
    playerCount: 0,
    botCount: 0,
    humanCount: 0,
    cardTypes: [],
    messages: [],
    lastSeenMessageId: null,
    status: "idle",
    pollTimer: null,
    isHost: false,
  },
};

const localTabBtn = document.querySelector("#local-tab");
const onlineTabBtn = document.querySelector("#online-tab");
const localSection = document.querySelector("#local-section");
const onlineSection = document.querySelector("#online-section");
const localSetupForm = document.querySelector("#setup-form");
const gameModeInput = document.querySelector("#game-mode");
const playerCountInput = document.querySelector("#player-count");
const cardTypesInput = document.querySelector("#card-types");
const onlineCreateForm = document.querySelector("#online-create-form");
const onlineJoinForm = document.querySelector("#online-join-form");
const onlineCreateBtn = onlineCreateForm.querySelector('button[type="submit"]');
const onlineJoinBtn = onlineJoinForm.querySelector('button[type="submit"]');
const themeToggleBtn = document.querySelector("#theme-toggle");
const chatPanel = document.querySelector("#chat-panel");
const chatMessages = document.querySelector("#chat-messages");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const chatSendBtn = document.querySelector("#chat-send-btn");
const emojiButtons = document.querySelectorAll(".emoji-btn");
const onlinePlayerNameInput = document.querySelector("#online-player-name");
const onlinePlayerCountInput = document.querySelector("#online-player-count");
const onlineBotCountInput = document.querySelector("#online-bot-count");
const onlineCardTypesInput = document.querySelector("#online-card-types");
const joinRoomCodeInput = document.querySelector("#join-room-code");
const joinPlayerNameInput = document.querySelector("#join-player-name");
const roomPanel = document.querySelector("#room-panel");
const roomCodeValue = document.querySelector("#room-code-value");
const roomStatus = document.querySelector("#room-status");
const inviteLinkInput = document.querySelector("#invite-link");
const copyInviteBtn = document.querySelector("#copy-invite-btn");
const roomPlayers = document.querySelector("#room-players");
const roomHint = document.querySelector("#room-hint");
const leaveRoomBtn = document.querySelector("#leave-room-btn");
const gameArea = document.querySelector("#game-area");
const winnerPanel = document.querySelector("#winner-panel");
const winnerTitle = document.querySelector("#winner-title");
const winnerCopy = document.querySelector("#winner-copy");
const playAgainBtn = document.querySelector("#play-again-btn");
const turnTitle = document.querySelector("#turn-title");
const starterBadge = document.querySelector("#starter-badge");
const exchangeBadge = document.querySelector("#exchange-badge");
const playersList = document.querySelector("#players-list");
const scoreboard = document.querySelector("#scoreboard");
const handTitle = document.querySelector("#hand-title");
const revealBtn = document.querySelector("#reveal-btn");
const passDevice = document.querySelector("#pass-device");
const handView = document.querySelector("#hand-view");
const computerTurn = document.querySelector("#computer-turn");
const computerTurnCopy = document.querySelector("#computer-turn-copy");
const cardsContainer = document.querySelector("#cards-container");
const newGameBtn = document.querySelector("#new-game-btn");

localTabBtn.addEventListener("click", () => switchMode("local"));
onlineTabBtn.addEventListener("click", () => switchMode("online"));

localSetupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  startLocalGame();
});

onlineCreateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await createOnlineRoom();
});

onlineJoinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await joinOnlineRoom();
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await sendChatMessage();
});

emojiButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    await sendReaction(button.dataset.emoji, button.dataset.reaction);
  });
});

revealBtn.addEventListener("click", () => {
  if (state.mode !== "local" || state.winner) {
    return;
  }

  state.handRevealed = true;
  render();
});

newGameBtn.addEventListener("click", () => {
  if (state.mode === "online" && state.remote.roomId) {
    fetchRoomState();
    return;
  }

  startLocalGame();
});

copyInviteBtn.addEventListener("click", async () => {
  if (!inviteLinkInput.value) {
    return;
  }

  try {
    await navigator.clipboard.writeText(inviteLinkInput.value);
    copyInviteBtn.textContent = "Copied";
    window.setTimeout(() => {
      copyInviteBtn.textContent = "Copy Link";
    }, 1200);
  } catch (error) {
    window.alert("Could not copy the invite link automatically.");
  }
});

leaveRoomBtn.addEventListener("click", () => {
  leaveOnlineRoom();
});

themeToggleBtn.addEventListener("click", () => {
  const nextTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
});

playAgainBtn.addEventListener("click", async () => {
  if (state.mode === "online" && state.remote.roomId) {
    await replayOnlineRoom();
    return;
  }

  replayLocalGame();
});

gameModeInput.addEventListener("change", () => {
  const isComputerMode = gameModeInput.value === "computer";
  playerCountInput.value = isComputerMode ? "4" : playerCountInput.value;
  playerCountInput.disabled = isComputerMode;
});

onlinePlayerCountInput.addEventListener("input", syncOnlineBotCountLimit);
onlineBotCountInput.addEventListener("input", syncOnlineBotCountLimit);

function syncOnlineBotCountLimit() {
  const playerCount = Number(onlinePlayerCountInput.value) || 0;
  const maxBots = Math.max(0, playerCount - 1);
  onlineBotCountInput.max = String(maxBots);
  const currentBots = Number(onlineBotCountInput.value) || 0;
  if (currentBots > maxBots) {
    onlineBotCountInput.value = String(maxBots);
  }
}

function switchMode(mode) {
  state.mode = mode;
  localTabBtn.classList.toggle("active", mode === "local");
  onlineTabBtn.classList.toggle("active", mode === "online");
  localSection.classList.toggle("hidden", mode !== "local");
  onlineSection.classList.toggle("hidden", mode !== "online");
  roomPanel.classList.toggle("hidden", mode !== "online" || !state.remote.roomId);
  render();
}

function applyTheme(theme) {
  const normalizedTheme = theme === "dark" ? "dark" : "light";
  document.body.dataset.theme = normalizedTheme;
  themeToggleBtn.textContent = normalizedTheme === "dark" ? "Light Mode" : "Dark Mode";
  themeToggleBtn.setAttribute("aria-pressed", String(normalizedTheme === "dark"));
  window.localStorage.setItem(THEME_STORAGE_KEY, normalizedTheme);
}

function loadSavedTheme() {
  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  applyTheme(savedTheme === "dark" ? "dark" : "light");
}

function startLocalGame() {
  state.scores = {};
  setupLocalRound({ resetScores: true });
}

function setupLocalRound({ resetScores = false } = {}) {
  clearComputerTurn();
  stopPolling();

  const gameMode = gameModeInput.value;
  const playerCount = Number(playerCountInput.value);
  const cardTypes = parseCardTypes(cardTypesInput.value);

  if (playerCount < 3 || playerCount > 6) {
    window.alert("Choose between 3 and 6 players.");
    return;
  }

  if (cardTypes.length < playerCount) {
    window.alert("Please enter at least as many card types as players.");
    return;
  }

  const selectedTypes = cardTypes.slice(0, playerCount);
  const starterIndex = randomNumber(playerCount);
  let hands;

  try {
    hands = dealHands(playerCount, selectedTypes, starterIndex);
  } catch (error) {
    window.alert(error.message);
    return;
  }

  state.players = hands.map((hand, index) => {
    const id = `local-${index + 1}`;
    const name = gameMode === "computer" && index > 0 ? `Computer ${index}` : `Player ${index + 1}`;

    if (resetScores || !state.scores[id]) {
      state.scores[id] = { name, wins: 0 };
    } else {
      state.scores[id].name = name;
    }

    return {
      id,
      name,
      hand,
      isComputer: gameMode === "computer" && index > 0,
    };
  });
  state.starterIndex = starterIndex;
  state.activePlayerIndex = starterIndex;
  state.turnCount = 1;
  state.winner = null;
  state.handRevealed = false;
  state.gameMode = gameMode;

  gameArea.classList.remove("hidden");
  winnerPanel.classList.add("hidden");
  playShuffleSound();
  render();
  maybeRunComputerTurn();
}

function replayLocalGame() {
  winnerPanel.classList.add("hidden");
  setupLocalRound();
}

async function createOnlineRoom() {
  if (onlineCreateBtn.disabled) {
    return;
  }

  clearComputerTurn();
  const playerName = onlinePlayerNameInput.value.trim();
  const playerCount = Number(onlinePlayerCountInput.value);
  const botCount = Number(onlineBotCountInput.value);
  const cardTypes = parseCardTypes(onlineCardTypesInput.value);

  if (!playerName) {
    window.alert("Enter your name to create the room.");
    return;
  }

  if (playerCount < 3 || playerCount > 6) {
    window.alert("Choose between 3 and 6 players.");
    return;
  }

  if (botCount < 0 || botCount > playerCount - 1) {
    window.alert("Choose a valid number of computer players.");
    return;
  }

  if (cardTypes.length < playerCount) {
    window.alert("Please enter at least as many card types as players.");
    return;
  }

  setButtonBusy(onlineCreateBtn, true, "Creating...");
  const response = await apiRequest("/api/rooms", {
    method: "POST",
    body: {
      playerName,
      playerCount,
      botCount,
      cardTypes: cardTypes.slice(0, playerCount),
    },
  });
  setButtonBusy(onlineCreateBtn, false, "Create Room");

  if (!response.ok) {
    window.alert(response.error || "Could not create room.");
    return;
  }

  connectToRoom({
    roomId: response.data.roomId,
    playerId: response.data.playerId,
    playerToken: response.data.playerToken,
    playerName,
    inviteUrl: response.data.inviteUrl,
    playerCount,
    botCount,
    humanCount: playerCount - botCount,
    cardTypes: cardTypes.slice(0, playerCount),
    isHost: true,
  });
  history.replaceState({}, "", buildRoomUrl(response.data.roomId));
  playShuffleSound();
  await fetchRoomState();
}

async function joinOnlineRoom() {
  if (onlineJoinBtn.disabled) {
    return;
  }

  clearComputerTurn();
  const roomId = sanitizeRoomId(joinRoomCodeInput.value);
  const playerName = joinPlayerNameInput.value.trim();
  const saved = getSavedRoomPlayer(roomId);

  if (!roomId || !playerName) {
    window.alert("Enter the room code and your name.");
    return;
  }

  setButtonBusy(onlineJoinBtn, true, "Joining...");
  const response = await apiRequest(`/api/rooms/${roomId}/join`, {
    method: "POST",
    headers: saved?.playerToken
      ? {
          "X-Player-Token": saved.playerToken,
        }
      : {},
    body: { playerName },
  });
  setButtonBusy(onlineJoinBtn, false, "Join Room");

  if (!response.ok) {
    window.alert(response.error || "Could not join room.");
    return;
  }

  connectToRoom({
    roomId,
    playerId: response.data.playerId,
    playerToken: response.data.playerToken,
    playerName,
    inviteUrl: response.data.inviteUrl,
    playerCount: response.data.playerCount,
    botCount: response.data.botCount ?? 0,
    humanCount: response.data.humanCount ?? response.data.playerCount,
    cardTypes: response.data.cardTypes,
    isHost: false,
  });
  history.replaceState({}, "", buildRoomUrl(roomId));
  await fetchRoomState();
}

function setButtonBusy(button, isBusy, label) {
  button.disabled = isBusy;
  button.textContent = label;
}

function connectToRoom({ roomId, playerId, playerToken, playerName, inviteUrl, playerCount, botCount, humanCount, cardTypes, isHost }) {
  stopPolling();
  state.mode = "online";
  state.remote.roomId = roomId;
  state.remote.playerId = playerId;
  state.remote.playerToken = playerToken;
  state.remote.playerName = playerName;
  state.remote.inviteUrl = inviteUrl;
  state.remote.playerCount = playerCount;
  state.remote.botCount = botCount || 0;
  state.remote.humanCount = humanCount || playerCount;
  state.remote.cardTypes = cardTypes;
  state.remote.messages = [];
  state.remote.lastSeenMessageId = null;
  state.remote.status = "waiting";
  state.remote.isHost = isHost;
  saveRoomPlayer(roomId, playerId, playerToken, playerName);
  switchMode("online");
}

function leaveOnlineRoom() {
  const currentRoomId = state.remote.roomId;
  stopPolling();
  state.remote = {
    roomId: null,
    playerId: null,
    playerToken: null,
    playerName: "",
    inviteUrl: "",
    playerCount: 0,
    botCount: 0,
    humanCount: 0,
    cardTypes: [],
    messages: [],
    lastSeenMessageId: null,
    status: "idle",
    pollTimer: null,
    isHost: false,
  };
  clearSavedRoomPlayer(currentRoomId);
  state.players = [];
  state.winner = null;
  state.scores = {};
  state.handRevealed = false;
  roomPanel.classList.add("hidden");
  gameArea.classList.add("hidden");
  winnerPanel.classList.add("hidden");
  history.replaceState({}, "", window.location.pathname);
  switchMode("online");
}

async function fetchRoomState() {
  if (!state.remote.roomId || !state.remote.playerToken) {
    return;
  }

  const response = await apiRequest(`/api/rooms/${state.remote.roomId}/state`, {
    headers: {
      "X-Player-Token": state.remote.playerToken,
    },
  });

  if (!response.ok) {
    roomHint.textContent = response.error || "Could not refresh room state.";
    if (response.status === 403) {
      clearSavedRoomPlayer(state.remote.roomId);
    }
    stopPolling();
    return;
  }

  applyRemoteState(response.data);
  ensurePolling();
}

function applyRemoteState(data) {
  const previousStatus = state.remote.status;
  const previousWinner = state.winner;

  state.remote.status = data.status;
  state.remote.inviteUrl = data.inviteUrl;
  state.remote.playerCount = data.playerCount;
  state.remote.botCount = data.botCount ?? 0;
  state.remote.humanCount = data.humanCount ?? data.playerCount;
  state.remote.cardTypes = data.cardTypes;
  state.remote.messages = data.messages || [];
  state.players = data.players;
  state.scores = Object.fromEntries(
    data.players.map((player) => [player.id, { name: player.name, wins: player.score ?? 0 }]),
  );
  state.starterIndex = data.starterIndex ?? 0;
  state.activePlayerIndex = data.activePlayerIndex ?? 0;
  state.turnCount = data.turnCount ?? 0;
  state.winner = data.winner;
  state.handRevealed = true;
  roomPanel.classList.remove("hidden");
  gameArea.classList.remove("hidden");
  winnerPanel.classList.toggle("hidden", !data.winner);
  chatPanel.classList.toggle("hidden", state.mode !== "online" || !state.remote.roomId);

  if ((previousStatus === "waiting" || previousStatus === "finished") && data.status === "playing") {
    playShuffleSound();
  }

  if (!previousWinner && data.winner) {
    playWinSound();
  }

  handleIncomingMessages(data.messages || []);

  if (data.winner) {
    winnerTitle.textContent = `${data.winner.name} wins!`;
    winnerCopy.textContent = `${data.winner.name} collected four ${data.winner.type} cards.`;
  }

  roomCodeValue.textContent = data.roomId;
  roomStatus.textContent = data.status === "waiting" ? "Waiting for players" : data.status === "playing" ? "Game in progress" : "Game finished";
  inviteLinkInput.value = data.inviteUrl;
  const humanJoined = data.players.filter((player) => !player.isBot).length;
  roomHint.textContent = data.status === "waiting"
    ? `${humanJoined} of ${data.humanCount} human players joined. ${data.botCount} computer player${data.botCount === 1 ? "" : "s"} will join the round automatically.`
    : `You are ${data.self.name}. Only your hand is visible to you.`;

  roomPlayers.innerHTML = "";
  data.players.forEach((player) => {
    const item = document.createElement("article");
    item.className = `player-item${player.id === data.self.id ? " active" : ""}`;
    item.innerHTML = `
      <div class="details">
        <strong>${player.name}${player.id === data.self.id ? " (You)" : ""}${player.isBot ? " (Computer)" : ""}</strong>
        <span>${player.cardCount} cards</span>
      </div>
      <span>${player.id === data.self.id ? summarizeHand(player.hand) : player.handSummary}</span>
    `;
    roomPlayers.appendChild(item);
  });

  render();
}

function ensurePolling() {
  stopPolling();
  state.remote.pollTimer = window.setTimeout(fetchRoomState, 1200);
}

function stopPolling() {
  if (state.remote.pollTimer) {
    window.clearTimeout(state.remote.pollTimer);
    state.remote.pollTimer = null;
  }
}

async function handleRemotePass(cardId) {
  const response = await apiRequest(`/api/rooms/${state.remote.roomId}/pass`, {
    method: "POST",
    headers: {
      "X-Player-Token": state.remote.playerToken,
    },
    body: {
      cardId,
    },
  });

  if (!response.ok) {
    window.alert(response.error || "Could not play this card.");
    return;
  }

  playPassSound();
  applyRemoteState(response.data);
  ensurePolling();
}

async function replayOnlineRoom() {
  const response = await apiRequest(`/api/rooms/${state.remote.roomId}/replay`, {
    method: "POST",
    headers: {
      "X-Player-Token": state.remote.playerToken,
    },
  });

  if (!response.ok) {
    window.alert(response.error || "Could not start a new round.");
    return;
  }

  winnerPanel.classList.add("hidden");
  applyRemoteState(response.data);
  ensurePolling();
}

async function sendChatMessage() {
  const text = chatInput.value.trim();

  if (!text || !state.remote.roomId) {
    return;
  }

  setButtonBusy(chatSendBtn, true, "Sending...");
  const response = await apiRequest(`/api/rooms/${state.remote.roomId}/messages`, {
    method: "POST",
    headers: {
      "X-Player-Token": state.remote.playerToken,
    },
    body: {
      text,
      emoji: "",
      reaction: "message",
    },
  });
  setButtonBusy(chatSendBtn, false, "Send");

  if (!response.ok) {
    window.alert(response.error || "Could not send message.");
    return;
  }

  chatInput.value = "";
  applyRemoteState(response.data);
  ensurePolling();
}

async function sendReaction(emoji, reaction) {
  if (!state.remote.roomId) {
    return;
  }

  const response = await apiRequest(`/api/rooms/${state.remote.roomId}/messages`, {
    method: "POST",
    headers: {
      "X-Player-Token": state.remote.playerToken,
    },
    body: {
      text: "",
      emoji,
      reaction,
    },
  });

  if (!response.ok) {
    window.alert(response.error || "Could not send reaction.");
    return;
  }

  applyRemoteState(response.data);
  ensurePolling();
}

function handleIncomingMessages(messages) {
  const lastSeenId = state.remote.lastSeenMessageId;
  const newMessages = lastSeenId
    ? messages.filter((message) => message.id > lastSeenId)
    : [];

  newMessages.forEach((message) => {
    if (message.playerId === state.remote.playerId) {
      return;
    }

    playChatSound(message.reaction);
  });

  state.remote.lastSeenMessageId = messages.length ? messages[messages.length - 1].id : lastSeenId;
}

function getAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    return null;
  }

  if (!audioContext) {
    audioContext = new AudioContextClass();
  }

  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }

  return audioContext;
}

function playTone({ frequency, duration, type = "sine", volume = 0.04, delay = 0 }) {
  const context = getAudioContext();

  if (!context) {
    return;
  }

  const startAt = context.currentTime + delay;
  const endAt = startAt + duration;
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gainNode.gain.setValueAtTime(0.0001, startAt);
  gainNode.gain.exponentialRampToValueAtTime(volume, startAt + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, endAt);

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(endAt);
}

function playShuffleSound() {
  playTone({ frequency: 280, duration: 0.08, type: "triangle", volume: 0.025, delay: 0 });
  playTone({ frequency: 360, duration: 0.08, type: "triangle", volume: 0.025, delay: 0.05 });
  playTone({ frequency: 430, duration: 0.1, type: "triangle", volume: 0.03, delay: 0.1 });
}

function playPassSound() {
  playTone({ frequency: 520, duration: 0.06, type: "square", volume: 0.02, delay: 0 });
  playTone({ frequency: 680, duration: 0.08, type: "square", volume: 0.018, delay: 0.05 });
}

function playWinSound() {
  playTone({ frequency: 523.25, duration: 0.12, type: "triangle", volume: 0.04, delay: 0 });
  playTone({ frequency: 659.25, duration: 0.12, type: "triangle", volume: 0.04, delay: 0.12 });
  playTone({ frequency: 783.99, duration: 0.18, type: "triangle", volume: 0.045, delay: 0.24 });
  playTone({ frequency: 1046.5, duration: 0.28, type: "triangle", volume: 0.05, delay: 0.4 });
}

function playChatSound(reaction) {
  if (reaction === "laughter") {
    playTone({ frequency: 720, duration: 0.08, type: "triangle", volume: 0.03, delay: 0 });
    playTone({ frequency: 880, duration: 0.08, type: "triangle", volume: 0.03, delay: 0.08 });
    return;
  }

  if (reaction === "sad") {
    playTone({ frequency: 420, duration: 0.14, type: "sine", volume: 0.028, delay: 0 });
    playTone({ frequency: 320, duration: 0.18, type: "sine", volume: 0.028, delay: 0.12 });
    return;
  }

  if (reaction === "angry") {
    playTone({ frequency: 260, duration: 0.06, type: "square", volume: 0.028, delay: 0 });
    playTone({ frequency: 220, duration: 0.1, type: "square", volume: 0.03, delay: 0.05 });
    return;
  }

  if (reaction === "clap") {
    playTone({ frequency: 900, duration: 0.04, type: "square", volume: 0.025, delay: 0 });
    playTone({ frequency: 900, duration: 0.04, type: "square", volume: 0.025, delay: 0.08 });
    return;
  }

  playTone({ frequency: 600, duration: 0.07, type: "triangle", volume: 0.022, delay: 0 });
}

function parseCardTypes(input) {
  const names = input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return names.length ? names : defaultCardTypes;
}

function buildDeck(cardTypes, starterTypeIndex) {
  return cardTypes.flatMap((type, index) => {
    const copies = index === starterTypeIndex ? 5 : 4;
    return Array.from({ length: copies }, (_, cardIndex) => ({
      id: `${type}-${cardIndex + 1}`,
      type,
    }));
  });
}

function dealHands(playerCount, cardTypes, starterIndex) {
  const handSizes = Array.from({ length: playerCount }, (_, index) =>
    index === starterIndex ? 5 : 4,
  );

  for (let attempt = 0; attempt < 300; attempt += 1) {
    const deck = shuffle(buildDeck(cardTypes, 0));
    const hands = [];
    let cursor = 0;

    for (const handSize of handSizes) {
      hands.push(deck.slice(cursor, cursor + handSize));
      cursor += handSize;
    }

    if (!hands.some((hand) => hasFourOfAKind(hand))) {
      return hands;
    }
  }

  throw new Error("Could not create a fair opening deal. Please try again.");
}

function shuffle(items) {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = randomNumber(index + 1);
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy;
}

function randomNumber(max) {
  return Math.floor(Math.random() * max);
}

function render() {
  const isOnline = state.mode === "online" && state.remote.roomId;
  if (!state.players.length && !isOnline) {
    return;
  }

  renderStatus();
  renderScores();
  renderPlayers();
  renderHand();
  renderChat();
}

function renderScores() {
  scoreboard.innerHTML = "";

  const entries = Object.entries(state.scores)
    .map(([id, score]) => ({ id, ...score }))
    .sort((left, right) => right.wins - left.wins || left.name.localeCompare(right.name));

  entries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "score-row";
    row.innerHTML = `
      <strong>${entry.name}${state.mode === "online" && entry.id === state.remote.playerId ? " (You)" : ""}</strong>
      <span class="score-value">${entry.wins}</span>
    `;
    scoreboard.appendChild(row);
  });
}

function renderChat() {
  if (state.mode !== "online" || !state.remote.roomId) {
    chatPanel.classList.add("hidden");
    return;
  }

  chatPanel.classList.remove("hidden");
  chatMessages.innerHTML = "";

  state.remote.messages.forEach((message) => {
    const item = document.createElement("article");
    item.className = "chat-message";
    item.innerHTML = `
      <strong>${message.playerName}${message.playerId === state.remote.playerId ? " (You)" : ""}</strong>
      <p>${message.emoji ? `${message.emoji} ` : ""}${message.text || message.reactionLabel}</p>
      <div class="chat-meta">${message.timeLabel}</div>
    `;
    chatMessages.appendChild(item);
  });

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderStatus() {
  const activePlayer = state.players[state.activePlayerIndex];
  const nextPlayer = state.players[(state.activePlayerIndex + 1) % state.players.length];

  if (!activePlayer) {
    return;
  }

  turnTitle.textContent = `${activePlayer.name}'s turn`;
  starterBadge.textContent = `Starter: ${state.players[state.starterIndex]?.name || activePlayer.name}`;
  exchangeBadge.textContent = state.winner
    ? "Game complete"
    : `${activePlayer.name} passes one card to ${nextPlayer?.name || activePlayer.name}`;
}

function renderPlayers() {
  playersList.innerHTML = "";

  state.players.forEach((player, index) => {
    let cardSummary;

    if (state.mode === "online") {
      cardSummary = player.id === state.remote.playerId ? summarizeHand(player.hand) : player.handSummary;
    } else {
      const showSummary = state.gameMode !== "computer" || !player.isComputer || state.winner;
      cardSummary = showSummary ? summarizeHand(player.hand) : "Hand hidden";
    }

    const item = document.createElement("article");
    item.className = `player-item${index === state.activePlayerIndex ? " active" : ""}`;
    item.innerHTML = `
      <div class="details">
      <strong>${player.name}${state.mode === "online" && player.id === state.remote.playerId ? " (You)" : ""}${player.isBot ? " (Computer)" : ""}</strong>
      <span>${state.mode === "online" ? player.cardCount : player.hand.length} cards</span>
      </div>
      <span>${cardSummary}</span>
    `;
    playersList.appendChild(item);
  });
}

function renderHand() {
  const activePlayer = state.players[state.activePlayerIndex];
  const isOnline = state.mode === "online" && state.remote.roomId;

  if (!activePlayer) {
    return;
  }

  if (isOnline) {
    renderRemoteHand();
    return;
  }

  const isComputerTurn = Boolean(activePlayer?.isComputer) && !state.winner;

  handTitle.textContent = state.handRevealed
    ? `${activePlayer.name}'s hand`
    : "Hidden hand";
  revealBtn.disabled = state.handRevealed || Boolean(state.winner) || isComputerTurn;
  revealBtn.textContent = state.winner ? "Game Over" : isComputerTurn ? "Computer Thinking" : "Reveal Current Hand";

  if (!state.handRevealed || state.winner) {
    passDevice.classList.remove("hidden");
    handView.classList.add("hidden");
    computerTurn.classList.add("hidden");
    passDevice.textContent = state.winner
      ? "Start a new deal to play again."
      : `Pass the device to ${activePlayer.name}, then reveal the hand.`;
    if (!isComputerTurn) {
      return;
    }
  }

  if (isComputerTurn) {
    passDevice.classList.add("hidden");
    handView.classList.add("hidden");
    computerTurn.classList.remove("hidden");
    computerTurnCopy.textContent = `${activePlayer.name} is choosing a card. Their hand stays hidden for about 3 seconds.`;
    return;
  }

  passDevice.classList.add("hidden");
  computerTurn.classList.add("hidden");
  handView.classList.remove("hidden");
  cardsContainer.innerHTML = "";

  activePlayer.hand.forEach((card) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "card-btn";
    button.innerHTML = createCardMarkup(card, true);
    button.addEventListener("click", () => passCard(card.id));
    cardsContainer.appendChild(button);
  });
}

function renderRemoteHand() {
  const selfPlayer = state.players.find((player) => player.id === state.remote.playerId);
  const activePlayer = state.players[state.activePlayerIndex];
  const isMyTurn = Boolean(activePlayer && activePlayer.id === state.remote.playerId && !state.winner);

  handTitle.textContent = selfPlayer ? `${selfPlayer.name}'s hand` : "Your hand";
  revealBtn.disabled = true;
  revealBtn.textContent = "Online Room";
  passDevice.classList.add("hidden");
  computerTurn.classList.add("hidden");
  handView.classList.remove("hidden");
  cardsContainer.innerHTML = "";

  if (!selfPlayer) {
    return;
  }

  selfPlayer.hand.forEach((card) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "card-btn";
    button.disabled = !isMyTurn;
    button.innerHTML = createCardMarkup(card, isMyTurn);
    if (isMyTurn) {
      button.addEventListener("click", () => handleRemotePass(card.id));
    }
    cardsContainer.appendChild(button);
  });

  if (!selfPlayer.hand.length) {
    handView.classList.add("hidden");
    passDevice.classList.remove("hidden");
    passDevice.textContent = "Waiting for the room to start.";
    return;
  }

  if (!isMyTurn && !state.winner) {
    passDevice.classList.remove("hidden");
    passDevice.textContent = activePlayer.isBot
      ? `${activePlayer.name} is choosing a card automatically. Please wait about 3 seconds.`
      : `${activePlayer.name} is deciding which card to pass.`;
  }
}

function createCardMarkup(card, actionable) {
  const initial = card.type.charAt(0).toUpperCase();
  const art = getCardArt(card.type);

  return `
    <div class="card-face card-theme-${art.aura}${actionable ? " actionable" : ""}" aria-label="${card.type} card">
      <div class="card-corner top">
        <div class="card-initial">${initial}</div>
        <div class="card-mark">◆</div>
      </div>
      <div class="card-center">
        <div class="card-figure" aria-hidden="true">
          <div class="card-halo"></div>
          <div class="card-figure-icon">${art.icon}</div>
        </div>
        <div class="card-medallion">${initial}</div>
        <div class="card-label">${card.type}</div>
        <div class="card-figure-caption">${art.figure}</div>
        <div class="card-meta">${actionable ? "Tap to pass this card to the next player." : "Waiting for your turn."}</div>
      </div>
      <div class="card-corner bottom">
        <div class="card-initial">${initial}</div>
        <div class="card-mark">◆</div>
      </div>
    </div>
  `;
}

function getCardArt(type) {
  const normalizedType = String(type || "").trim().toLowerCase();
  if (cardArtMap[normalizedType]) {
    return cardArtMap[normalizedType];
  }

  return {
    icon: "✨",
    aura: "default",
    figure: "Special character card",
  };
}

function passCard(cardId) {
  if (state.winner) {
    return;
  }

  const currentPlayer = state.players[state.activePlayerIndex];
  const nextPlayerIndex = (state.activePlayerIndex + 1) % state.players.length;
  const nextPlayer = state.players[nextPlayerIndex];
  const cardIndex = currentPlayer.hand.findIndex((card) => card.id === cardId);

  if (cardIndex === -1) {
    return;
  }

  const [cardToPass] = currentPlayer.hand.splice(cardIndex, 1);
  nextPlayer.hand.push(cardToPass);
  playPassSound();

  const winningPlayer = state.players.find((player) => hasFourOfAKind(player.hand));

  if (winningPlayer) {
    if (state.scores[winningPlayer.id]) {
      state.scores[winningPlayer.id].wins += 1;
    }
    state.winner = {
      id: winningPlayer.id,
      name: winningPlayer.name,
      type: mostCommonType(winningPlayer.hand),
    };
    state.handRevealed = false;
    clearComputerTurn();
    winnerPanel.classList.remove("hidden");
    winnerTitle.textContent = `${winningPlayer.name} wins!`;
    winnerCopy.textContent = `${winningPlayer.name} collected four ${mostCommonType(winningPlayer.hand)} cards.`;
    playWinSound();
    render();
    return;
  }

  state.activePlayerIndex = nextPlayerIndex;
  state.turnCount += 1;
  state.handRevealed = false;
  render();
  maybeRunComputerTurn();
}

function maybeRunComputerTurn() {
  clearComputerTurn();

  const activePlayer = state.players[state.activePlayerIndex];

  if (!activePlayer || !activePlayer.isComputer || state.winner) {
    return;
  }

  state.computerTimer = window.setTimeout(() => {
    const chosenCard = chooseComputerCard(activePlayer.hand);
    passCard(chosenCard.id);
  }, COMPUTER_TURN_DELAY_MS);
}

function clearComputerTurn() {
  if (!state.computerTimer) {
    return;
  }

  window.clearTimeout(state.computerTimer);
  state.computerTimer = null;
}

function chooseComputerCard(hand) {
  const counts = countTypes(hand);
  const rankedCards = [...hand].sort((left, right) => {
    const leftCount = counts[left.type];
    const rightCount = counts[right.type];

    if (leftCount !== rightCount) {
      return leftCount - rightCount;
    }

    return left.type.localeCompare(right.type);
  });

  return rankedCards[0];
}

function hasFourOfAKind(hand) {
  const counts = countTypes(hand);
  return Object.values(counts).some((count) => count >= 4);
}

function countTypes(hand) {
  return hand.reduce((totals, card) => {
    totals[card.type] = (totals[card.type] || 0) + 1;
    return totals;
  }, {});
}

function summarizeHand(hand) {
  const counts = countTypes(hand);
  const bestType = Object.entries(counts).sort((left, right) => right[1] - left[1])[0];

  if (!bestType) {
    return "No cards";
  }

  return `Best group: ${bestType[1]} matching card${bestType[1] > 1 ? "s" : ""}`;
}

function mostCommonType(hand) {
  const counts = countTypes(hand);
  return Object.entries(counts).sort((left, right) => right[1] - left[1])[0][0];
}

async function apiRequest(path, options = {}) {
  try {
    const response = await fetch(path, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await response.json();
    return {
      ok: response.ok,
      data,
      error: data.error,
      status: response.status,
    };
  } catch (error) {
    return {
      ok: false,
      error: "Could not reach the game server. Start server.py and open the site through it.",
      status: 0,
    };
  }
}

function saveRoomPlayer(roomId, playerId, playerToken, playerName) {
  const map = JSON.parse(window.localStorage.getItem(ROOM_STORAGE_KEY) || "{}");
  map[roomId] = { playerId, playerToken, playerName };
  window.localStorage.setItem(ROOM_STORAGE_KEY, JSON.stringify(map));
}

function getSavedRoomPlayer(roomId) {
  const map = JSON.parse(window.localStorage.getItem(ROOM_STORAGE_KEY) || "{}");
  return map[roomId] || null;
}

function clearSavedRoomPlayer(roomId) {
  if (!roomId) {
    return;
  }

  const map = JSON.parse(window.localStorage.getItem(ROOM_STORAGE_KEY) || "{}");
  delete map[roomId];
  window.localStorage.setItem(ROOM_STORAGE_KEY, JSON.stringify(map));
}

function sanitizeRoomId(value) {
  return value.trim().toUpperCase();
}

function buildRoomUrl(roomId) {
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomId);
  return `${url.pathname}?${url.searchParams.toString()}`;
}

async function bootstrapRoomFromUrl() {
  const roomId = sanitizeRoomId(new URLSearchParams(window.location.search).get("room") || "");

  if (!roomId) {
    startLocalGame();
    return;
  }

  switchMode("online");
  joinRoomCodeInput.value = roomId;
  const saved = getSavedRoomPlayer(roomId);

  if (saved?.playerToken) {
    connectToRoom({
      roomId,
      playerId: saved.playerId,
      playerToken: saved.playerToken,
      playerName: saved.playerName,
      inviteUrl: window.location.href,
      playerCount: 0,
      botCount: 0,
      humanCount: 0,
      cardTypes: [],
      isHost: false,
    });
    await fetchRoomState();
    return;
  }

  if (saved && !saved.playerToken) {
    clearSavedRoomPlayer(roomId);
  }

  roomPanel.classList.add("hidden");
  roomHint.textContent = "Enter your name and join this room.";
}

loadSavedTheme();
bootstrapRoomFromUrl();
syncOnlineBotCountLimit();

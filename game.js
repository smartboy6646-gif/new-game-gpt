// game.js

// --- Global State ---
let myId = null;
let roomId = null;
let roomRef = null;
let playerRef = null;
let gameState = null;
let myHand = [];
let players = [];
let audio = new Audio('pop.mp3'); // Ensure pop.mp3 exists

// Suits: S=Spades, H=Hearts, C=Clubs, D=Diamonds
const SUITS = ['S', 'H', 'C', 'D'];
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const VALUES = { '2':2, '3':3, '4':4, '5':5, '6':6, '7':7, '8':8, '9':9, '10':10, 'J':11, 'Q':12, 'K':13, 'A':14 };

// --- DOM Elements ---

  // --- DOM Elements (Updated) ---
const ui = {
    // ... keep existing UI references ...
    hand: document.getElementById('my-hand'),
    trick: document.getElementById('trick-area'),
    status: document.getElementById('turn-indicator'),
    bidOverlay: document.getElementById('bid-overlay'),
    scoreOverlay: document.getElementById('score-overlay'),
    scoreTable: document.querySelector('#score-table tbody'),
    
    // NEW references
    btnCreate: document.getElementById('btn-create'),
    btnJoin: document.getElementById('btn-join'),
    nameInput: document.getElementById('player-name'),
    roomInput: document.getElementById('room-code-input')
};

// --- Networking & Setup ---

// OPTION 1: Create a New Room
ui.btnCreate.addEventListener('click', () => {
    const name = ui.nameInput.value.trim();
    if (!name) return alert("Please enter your name!");

    // Generate a simple 4-digit Room Code
    const newRoomId = Math.floor(1000 + Math.random() * 9000).toString();
    
    joinGame(name, newRoomId, true); // true = creating
});

// OPTION 2: Join Existing Room
ui.btnJoin.addEventListener('click', () => {
    const name = ui.nameInput.value.trim();
    const roomCode = ui.roomInput.value.trim();

    if (!name) return alert("Please enter your name!");
    if (!roomCode) return alert("Please enter a Room Code!");

    joinGame(name, roomCode, false); // false = joining
});

async function joinGame(name, targetRoomId, isCreating) {
    document.getElementById('status-msg').innerText = isCreating ? "Creating room..." : "Joining room...";
    
    const roomSnap = await dbRef.rooms.child(targetRoomId).once('value');
    const roomExists = roomSnap.exists();

    if (isCreating && roomExists) {
        // Only happens if random ID collides, retry automatically
        ui.btnCreate.click(); 
        return;
    }

    if (!isCreating && !roomExists) {
        alert("Room not found! Check the code.");
        document.getElementById('status-msg').innerText = "Room not found.";
        return;
    }

    // Check if room is full
    if (!isCreating && roomSnap.val().players && Object.keys(roomSnap.val().players).length >= 4) {
        alert("Room is full!");
        return;
    }

    // Setup Room Data if creating
    if (isCreating) {
        await dbRef.rooms.child(targetRoomId).set({
            status: 'WAITING',
            round: 1,
            turnIndex: 0,
            trick: [],
            trumpBroken: false
        });
    }

    // Connect
    roomId = targetRoomId;
    myId = 'p_' + Math.random().toString(36).substr(2, 9);
    roomRef = dbRef.rooms.child(roomId);
    playerRef = roomRef.child('players').child(myId);

    // Add Player
    await playerRef.set({
        name: name,
        id: myId,
        score: 0,
        tricksWon: 0,
        bid: 0,
        hand: [],
        ready: true
    });

    // Handle Disconnect
    playerRef.onDisconnect().remove();

    setupListeners();
    screens.login.classList.remove('active');
    screens.game.classList.add('active');
    
    // Show Room ID on screen so you can share it
    document.getElementById('room-id-display').innerText = roomId; 
}

// ... Keep the rest of the file (setupListeners, renderGame, etc.) exactly the same ...
function setupListeners() {
    roomRef.on('value', snap => {
        const data = snap.val();
        if (!data) return alert("Room closed"); // Basic handling
        gameState = data;
        players = Object.values(data.players || {});
        
        // Auto-start if 4 players and waiting
        if (players.length === 4 && data.status === 'WAITING' && isHost()) {
            startRound();
        }

        renderGame();
    });
}

function isHost() {
    // Simplest host logic: The player with the "smallest" ID string (lexicographically) 
    // or just the first one in the object keys.
    const ids = Object.keys(gameState.players).sort();
    return ids[0] === myId;
}

// --- Game Logic: State Transitions ---

function startRound() {
    const deck = createDeck();
    const hands = dealDeck(deck);
    const updates = { status: 'BIDDING', trick: [], trickStarter: 0, turnIndex: 0 };
    
    // Assign hands to players in DB
    const pIds = Object.keys(gameState.players).sort();
    pIds.forEach((pid, idx) => {
        updates[`players/${pid}/hand`] = hands[idx];
        updates[`players/${pid}/bid`] = 0;
        updates[`players/${pid}/tricksWon`] = 0;
        updates[`players/${pid}/currentCard`] = null; // Clear previous played card
    });
    
    roomRef.update(updates);
}

function createDeck() {
    let d = [];
    SUITS.forEach(s => RANKS.forEach(r => d.push({suit:s, rank:r, val:VALUES[r]})));
    // Shuffle
    for(let i=d.length-1; i>0; i--){
        const j = Math.floor(Math.random()*(i+1));
        [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
}

function dealDeck(deck) {
    // 4 hands of 13
    return [deck.slice(0,13), deck.slice(13,26), deck.slice(26,39), deck.slice(39,52)];
}

// --- UI Rendering ---

function renderGame() {
    if(!gameState) return;

    // 1. Position Players (Rotate so "Me" is bottom)
    const pIds = Object.keys(gameState.players).sort();
    const myIdx = pIds.indexOf(myId);
    
    // Map relative indices: 0=Me, 1=Right, 2=Top, 3=Left
    const positions = ['me', 'right', 'top', 'left'];
    
    pIds.forEach((pid, i) => {
        // Calculate relative index based on my position
        // If myIdx is 0, i=0 -> 0 (me), i=1 -> 1 (right)
        // If myIdx is 1, i=1 -> 0 (me), i=2 -> 1 (right)
        let relIdx = (i - myIdx + 4) % 4;
        const domId = `p-${positions[relIdx]}`;
        const pData = gameState.players[pid];
        
        const el = document.getElementById(domId);
        if(el) {
            el.querySelector('.p-name').innerText = pData.name;
            el.querySelector('.p-info').innerText = `Bid: ${pData.bid || '-'} / Won: ${pData.tricksWon}`;
            
            // Highlight turn
            if(gameState.status === 'PLAYING' || gameState.status === 'BIDDING') {
                if(i === gameState.turnIndex) el.classList.add('active-turn');
                else el.classList.remove('active-turn');
            }
        }
    });

    // 2. My Hand
    const me = gameState.players[myId];
    if (me && me.hand) {
        renderHand(me.hand);
        document.getElementById('my-bid').innerText = me.bid;
        document.getElementById('my-won').innerText = me.tricksWon;
    }

    // 3. Status Text
    if(gameState.status === 'WAITING') ui.status.innerText = `Waiting for players (${players.length}/4)...`;
    else if(gameState.status === 'BIDDING') ui.status.innerText = `Bidding phase...`;
    else if(gameState.status === 'PLAYING') {
        const turnPlayerId = pIds[gameState.turnIndex];
        const name = gameState.players[turnPlayerId].name;
        ui.status.innerText = (turnPlayerId === myId) ? "YOUR TURN" : `${name}'s Turn`;
    }

    // 4. Overlays
    // Bidding
    if(gameState.status === 'BIDDING' && me.bid === 0) {
        ui.bidOverlay.classList.remove('hidden');
        renderBidButtons();
    } else {
        ui.bidOverlay.classList.add('hidden');
    }

    // Trick Area
    renderTrick(pIds, myIdx);
    
    // Scoreboard (Round End)
    if(gameState.status === 'SCORING') {
        renderScoreboard();
        ui.scoreOverlay.classList.remove('hidden');
    } else {
        ui.scoreOverlay.classList.add('hidden');
    }
}

function renderHand(handArray) {
    ui.hand.innerHTML = '';
    // Sort hand: Spades, Hearts, Clubs, Diamonds (or alternates colors)
    // Custom sort: Suit priority then Value
    handArray.sort((a,b) => {
        if(a.suit !== b.suit) return a.suit.localeCompare(b.suit);
        return b.val - a.val; // High to low
    });

    handArray.forEach((card, idx) => {
        const div = document.createElement('div');
        div.className = `card ${['H','D'].includes(card.suit)?'red':'black'}`;
        div.innerHTML = `${getSuitIcon(card.suit)}<br>${card.rank}`;
        div.onclick = () => playCard(card, idx);
        
        // Validation highlighting
        if(gameState.status === 'PLAYING' && isMyTurn()) {
            if(!isValidMove(card)) div.classList.add('disabled');
        } else {
            div.classList.add('disabled'); // Not my turn
        }
        
        ui.hand.appendChild(div);
    });
}

function renderTrick(pIds, myIdx) {
    ui.trick.innerHTML = '';
    if(!gameState.trick) return;

    // Trick array stores { playerId, card }
    // We need to position them visually based on relative position
    gameState.trick.forEach(play => {
        // Find owner index
        const ownerIdx = pIds.indexOf(play.playerId);
        let relIdx = (ownerIdx - myIdx + 4) % 4; // 0=me, 1=right, 2=top, 3=left
        
        const cardDiv = document.createElement('div');
        cardDiv.className = `played-card ${['H','D'].includes(play.card.suit)?'red':'black'}`;
        cardDiv.innerHTML = `${play.card.rank} ${getSuitIcon(play.card.suit)}`;
        
        // CSS transforms to place them
        // Me: translate(0, 40px)
        // Right: translate(60px, 0)
        // Top: translate(0, -40px)
        // Left: translate(-60px, 0)
        const transforms = [
            'translate(0, 50px)', 'translate(60px, 0)', 'translate(0, -50px)', 'translate(-60px, 0)'
        ];
        cardDiv.style.transform = transforms[relIdx];
        ui.trick.appendChild(cardDiv);
    });
}

function renderBidButtons() {
    const container = document.getElementById('bid-buttons');
    container.innerHTML = '';
    for(let i=1; i<=8; i++) {
        const btn = document.createElement('button');
        btn.innerText = i;
        btn.onclick = () => submitBid(i);
        container.appendChild(btn);
    }
}

function renderScoreboard() {
    ui.scoreTable.innerHTML = '';
    Object.values(gameState.players).forEach(p => {
        const tr = document.createElement('tr');
        // Score calc logic applied previously, here we just show
        tr.innerHTML = `<td>${p.name}</td><td>${p.bid}</td><td>${p.tricksWon}</td><td>${p.score.toFixed(1)}</td>`;
        ui.scoreTable.appendChild(tr);
    });
    
    if(isHost()) {
        const btn = document.getElementById('btn-next-round');
        btn.classList.remove('hidden');
        btn.onclick = nextRound;
    }
}

function getSuitIcon(s) {
    const icons = { 'S':'♠', 'H':'♥', 'C':'♣', 'D':'♦' };
    return icons[s];
}

// --- Player Actions ---

function submitBid(amount) {
    roomRef.child(`players/${myId}/bid`).set(amount);
    
    // Check if everyone bid
    const allBids = Object.values(gameState.players).every(p => p.bid > 0);
    if(allBids) {
        // Only host triggers state change to keep sync clean
        if(isHost()) {
            roomRef.update({ status: 'PLAYING', turnIndex: gameState.trickStarter || 0 });
        }
    }
}

function isMyTurn() {
    const pIds = Object.keys(gameState.players).sort();
    return pIds[gameState.turnIndex] === myId;
}

function isValidMove(card) {
    const trick = gameState.trick || [];
    if(trick.length === 0) return true; // Lead any card

    const leadCard = trick[0].card;
    const leadSuit = leadCard.suit;
    
    // Rule 1: Must follow suit
    const hasLeadSuit = myHandContains(leadSuit);
    if(hasLeadSuit) {
        if(card.suit === leadSuit) {
            // Optional: Must beat highest card of suit (Standard Callbreak rule)
            // For simplicity in this demo, just follow suit is enforced strictly.
            // Advanced check: if I have higher card of lead suit than current highest, I should play it.
            return true;
        }
        return false;
    }

    // Rule 2: If no lead suit, must play Spade (Trump)
    const hasSpade = myHandContains('S');
    if(hasSpade) {
        if(card.suit === 'S') {
            // Must beat existing spades if possible
            return true;
        }
        return false; 
    }

    // Rule 3: No lead suit, no spade -> Play anything
    return true;
}

function myHandContains(suit) {
    const me = gameState.players[myId];
    return me.hand.some(c => c.suit === suit);
}

function playCard(card, indexInHand) {
    if(!isMyTurn()) return;
    if(!isValidMove(card)) return; // Double check
    
    audio.play().catch(e=>{}); // Simple sound trigger

    // Remove from local hand optimistically (DB update handles real state)
    // Actually, let's just push to DB and let the listener update UI
    const me = gameState.players[myId];
    const newHand = me.hand.filter((_, i) => i !== indexInHand);
    
    // 1. Update Hand
    roomRef.child(`players/${myId}/hand`).set(newHand);
    
    // 2. Add to Trick
    const currentTrick = gameState.trick || [];
    currentTrick.push({ playerId: myId, card: card });
    roomRef.child('trick').set(currentTrick);
    
    // 3. Update Turn
    let nextTurn = (gameState.turnIndex + 1) % 4;
    
    // Check if trick complete (4 cards)
    if(currentTrick.length === 4) {
        // Wait small delay then evaluate winner (handled by Host or everyone? Better Host)
        if(isHost()) {
            setTimeout(() => evaluateTrick(currentTrick), 1500);
        }
        // Set turn to -1 to block inputs during animation
        roomRef.update({ turnIndex: -1 }); 
    } else {
        roomRef.update({ turnIndex: nextTurn });
    }
}

function evaluateTrick(trick) {
    // Determine winner
    const leadSuit = trick[0].card.suit;
    let highestRank = -1;
    let winnerId = null;
    let playedSpade = false;

    // Check for Spades first
    trick.forEach(p => { if(p.card.suit === 'S') playedSpade = true; });

    const targetSuit = playedSpade ? 'S' : leadSuit;

    trick.forEach(p => {
        if(p.card.suit === targetSuit) {
            if(p.card.val > highestRank) {
                highestRank = p.card.val;
                winnerId = p.playerId;
            }
        }
    });

    // Update Winner stats
    const winnerRef = roomRef.child(`players/${winnerId}`);
    winnerRef.child('tricksWon').transaction(cur => (cur || 0) + 1);

    // Determine next leader index
    const pIds = Object.keys(gameState.players).sort();
    const winnerIdx = pIds.indexOf(winnerId);

    // Check if Round Over (Everyone out of cards)
    // We can check if any player has 0 cards, or just count tricks. 
    // 13 tricks per round.
    // However, simplest check: is players[myId].hand empty?
    // Since we are host, we check our own hand or track a global counter.
    // Easier: Check DB hand length of p1.
    dbRef.rooms.child(roomId).child(`players/${pIds[0]}/hand`).once('value', snap => {
        if(!snap.exists() || snap.val().length === 0) {
            endRound();
        } else {
            // Next Trick
            roomRef.update({
                trick: [],
                turnIndex: winnerIdx
            });
        }
    });
}

function endRound() {
    // Calculate Scores
    const updates = {};
    Object.keys(gameState.players).forEach(pid => {
        const p = gameState.players[pid];
        let roundScore = 0;
        if(p.tricksWon < p.bid) {
            roundScore = -p.bid;
        } else {
            roundScore = p.bid + (p.tricksWon - p.bid) * 0.1;
        }
        updates[`players/${pid}/score`] = (p.score || 0) + roundScore;
    });
    
    updates.status = 'SCORING';
    roomRef.update(updates);
}

function nextRound() {
    // Reset for next round
    // Move dealer/turn? Usually rotate.
    const nextRoundNum = gameState.round + 1;
    // Rotate starter
    const newStarter = (gameState.round) % 4; // Round 1 starts at 0, Round 2 starts at 1...
    
    roomRef.update({
        round: nextRoundNum,
        trickStarter: newStarter,
        status: 'WAITING_DEAL' // Intermediate state to trigger deal
    }).then(() => {
        startRound(); // Host deals again
    });
}

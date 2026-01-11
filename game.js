const suits = ["♠","♥","♦","♣"];
const values = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];

const roomId = "room1";
const playerId = "P" + Math.floor(Math.random()*10000);

let gameRef = db.ref("rooms/" + roomId);

gameRef.once("value", snap => {
  if (!snap.exists()) {
    gameRef.set({
      players: {},
      turn: null,
      phase: "waiting",
      table: []
    });
  }
  joinGame();
});

function joinGame() {
  const pRef = gameRef.child("players/" + playerId);
  pRef.set({
    bid: null,
    hand: [],
    tricks: 0
  });

  gameRef.child("players").on("value", snap => {
    document.getElementById("players").innerHTML = "";
    snap.forEach(p => {
      let d = document.createElement("div");
      d.className = "player";
      d.textContent = p.key;
      document.getElementById("players").appendChild(d);
    });

    if (snap.numChildren() === 4) startGame();
  });
}

function startGame() {
  gameRef.child("phase").set("bidding");
  dealCards();
  document.getElementById("bidding").classList.remove("hidden");
}

function dealCards() {
  let deck = [];
  suits.forEach(s => values.forEach(v => deck.push(v+s)));
  deck.sort(() => Math.random() - 0.5);

  gameRef.child("players").once("value", snap => {
    let i = 0;
    snap.forEach(p => {
      gameRef.child("players/"+p.key+"/hand").set(deck.slice(i,i+13));
      i += 13;
    });
  });
}

function submitBid() {
  let bid = document.getElementById("bidValue").value;
  gameRef.child("players/"+playerId+"/bid").set(parseInt(bid));
  document.getElementById("bidding").classList.add("hidden");
}

gameRef.child("players/"+playerId+"/hand").on("value", snap => {
  let handDiv = document.getElementById("hand");
  handDiv.innerHTML = "";
  snap.forEach(card => {
    let c = document.createElement("div");
    c.className = "card playable";
    c.textContent = card.val();
    c.onclick = () => playCard(card.val());
    handDiv.appendChild(c);
  });
});

function playCard(card) {
  document.getElementById("cardSound").play();
  gameRef.child("table").push({player: playerId, card});
  gameRef.child("players/"+playerId+"/hand").once("value", snap => {
    let newHand = snap.val().filter(c => c !== card);
    gameRef.child("players/"+playerId+"/hand").set(newHand);
  });
}

gameRef.child("table").on("value", snap => {
  let table = document.getElementById("table");
  table.innerHTML = "";
  snap.forEach(p => {
    let c = document.createElement("div");
    c.className = "card";
    c.textContent = p.val().card;
    table.appendChild(c);
  });
});

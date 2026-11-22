import assert from "node:assert";
import { screen, screenEvent, home } from "../plugin.js";

async function runTests() {
  console.log("1. Testing home()...");
  const h = await home();
  assert.ok(Array.isArray(h) && h.length > 0, "home should return array");
  console.log("   ✓ home() passed");

  console.log("2. Testing screen() chat tab with songs...");
  const sChat = await screen({
    state: {
      currentTab: "chat",
      messages: [
        {
          role: "assistant",
          text: "Música épica encontrada:",
          songs: [
            {
              title: "Time",
              artist: "Hans Zimmer",
              album: "Inception OST",
              poster: "https://lh3.googleusercontent.com/test.jpg",
              videoId: "RxabLA7UQ9k"
            }
          ]
        }
      ]
    }
  });
  assert.equal(sChat.type, "Scaffold");
  assert.equal(sChat.bottomNavigationBar.value, "chat");
  console.log("   ✓ screen(chat with songs) passed");

  console.log("3. Testing screen() music tab...");
  const sMusic = await screen({ state: { currentTab: "music" } });
  assert.equal(sMusic.appBar.title, "Tus Gustos Musicales");
  assert.equal(sMusic.bottomNavigationBar.value, "music");
  console.log("   ✓ screen(music) passed");

  console.log("4. Testing screenEvent(nav_change)...");
  const evNav = await screenEvent({ name: "nav_change", value: "music", state: { currentTab: "chat" } });
  assert.equal(evNav.state.currentTab, "music");
  console.log("   ✓ screenEvent(nav_change) passed");

  console.log("5. Testing screenEvent(new_chat)...");
  const evNew = await screenEvent({ name: "new_chat", state: { currentTab: "chat", messages: [{ role: "user", text: "hola" }] } });
  assert.equal(evNew.state.messages.length, 0);
  console.log("   ✓ screenEvent(new_chat) passed");

  console.log("All AI Center & YTMusic tests passed!");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});

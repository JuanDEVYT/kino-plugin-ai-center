import assert from "node:assert";
import { screen, screenEvent, home } from "../plugin.js";

async function runTests() {
  console.log("1. Testing home()...");
  const h = await home();
  assert.ok(Array.isArray(h) && h.length > 0, "home should return array");
  console.log("   ✓ home() passed");

  console.log("2. Testing screen() default tab (chat)...");
  const sChat = await screen({ state: { currentTab: "chat", messages: [] } });
  assert.equal(sChat.type, "Scaffold", "screen root must be Scaffold");
  assert.equal(sChat.appBar.title, "AI Center");
  assert.equal(sChat.bottomNavigationBar.value, "chat");
  console.log("   ✓ screen(chat) passed");

  console.log("3. Testing screen() lists tab...");
  const sLists = await screen({ state: { currentTab: "lists" } });
  assert.equal(sLists.appBar.title, "Mis Listas");
  assert.equal(sLists.bottomNavigationBar.value, "lists");
  console.log("   ✓ screen(lists) passed");

  console.log("4. Testing screen() music tab...");
  const sMusic = await screen({ state: { currentTab: "music" } });
  assert.equal(sMusic.appBar.title, "Tus Gustos Musicales");
  assert.equal(sMusic.bottomNavigationBar.value, "music");
  console.log("   ✓ screen(music) passed");

  console.log("5. Testing screen() sessions tab...");
  const sSessions = await screen({ state: { currentTab: "sessions" } });
  assert.equal(sSessions.appBar.title, "Historial de Sesiones");
  assert.equal(sSessions.bottomNavigationBar.value, "sessions");
  console.log("   ✓ screen(sessions) passed");

  console.log("6. Testing screenEvent(nav_change)...");
  const evNav = await screenEvent({ name: "nav_change", value: "lists", state: { currentTab: "chat" } });
  assert.equal(evNav.state.currentTab, "lists");
  console.log("   ✓ screenEvent(nav_change) passed");

  console.log("7. Testing screenEvent(new_chat)...");
  const evNew = await screenEvent({ name: "new_chat", state: { currentTab: "chat", messages: [{ role: "user", text: "hi" }] } });
  assert.equal(evNew.state.messages.length, 0);
  assert.ok(evNew.state.currentSessionId);
  console.log("   ✓ screenEvent(new_chat) passed");

  console.log("8. Testing screenEvent(random_pick)...");
  const evRandom = await screenEvent({ name: "random_pick", state: { currentTab: "chat", messages: [] } });
  assert.ok(evRandom.state.messages.length >= 2);
  console.log("   ✓ screenEvent(random_pick) passed");

  console.log("All AI Center tests passed successfully!");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});

const form = document.querySelector("#chat-form");
const input = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");
const messages = document.querySelector("#messages");
const suggestions = document.querySelector("#suggestions");
const clearButton = document.querySelector("#clear-chat-button");
const newTripButton = document.querySelector("#new-trip-button");
const inspirationButton = document.querySelector("#inspiration-button");

const starterMessage = [
  "Hi there! I'm your travel planning buddy. 🌿",
  "Share a destination, how long you have, or the kind of trip you're dreaming about. We can figure out the rest together.",
];
function addMessage(text, sender) {
  const article = document.createElement("article");
  article.className = `message ${sender}-message`;
  article.dataset.messageText = text;

  if (sender === "assistant") {
    const avatar = document.createElement("span");
    avatar.className = "message-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = "✳";
    article.append(avatar);
  }

  const content = document.createElement("div");
  content.className = "message-content";
  if (sender === "assistant") {
    renderMarkdown(content, text);
  } else {
    text.split("\n").filter((line) => line.trim()).forEach((line) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = line;
      content.append(paragraph);
    });
  }
  article.append(content);
  messages.append(article);
  scrollToLatest();
  return article;
}

function appendInlineMarkdown(container, text) {
  const pattern = /(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    container.append(document.createTextNode(text.slice(lastIndex, match.index)));
    const token = match[0];
    const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    let element;

    if (linkMatch) {
      try {
        const url = new URL(linkMatch[2]);
        if (url.protocol === "http:" || url.protocol === "https:") {
          element = document.createElement("a");
          element.href = url.href;
          element.target = "_blank";
          element.rel = "noopener noreferrer";
          element.textContent = linkMatch[1];
        }
      } catch {
        element = null;
      }
    } else if (token.startsWith("**") || token.startsWith("__")) {
      element = document.createElement("strong");
      element.textContent = token.slice(2, -2);
    } else if (token.startsWith("`")) {
      element = document.createElement("code");
      element.textContent = token.slice(1, -1);
    } else {
      element = document.createElement("em");
      element.textContent = token.slice(1, -1);
    }

    container.append(element || document.createTextNode(token));
    lastIndex = match.index + token.length;
  }

  container.append(document.createTextNode(text.slice(lastIndex)));
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function isBlockStart(lines, index) {
  const line = lines[index] || "";
  return /^#{1,6}\s+/.test(line)
    || /^\s*[-*+]\s+/.test(line)
    || /^\s*\d+[.)]\s+/.test(line)
    || /^\s*(```|~~~)/.test(line)
    || /^\s*(?:---+|\*\*\*|___)\s*$/.test(line)
    || (line.includes("|") && index + 1 < lines.length && isTableSeparator(lines[index + 1]));
}

function renderMarkdownTable(container, lines, startIndex) {
  const tableWrap = document.createElement("div");
  tableWrap.className = "markdown-table-wrap";
  const table = document.createElement("table");
  table.className = "markdown-table";
  const rows = [splitTableRow(lines[startIndex])];
  let index = startIndex + 2;

  while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
    rows.push(splitTableRow(lines[index]));
    index += 1;
  }

  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  rows[0].forEach((cellText) => {
    const cell = document.createElement("th");
    appendInlineMarkdown(cell, cellText);
    headRow.append(cell);
  });
  head.append(headRow);
  table.append(head);

  if (rows.length > 1) {
    const body = document.createElement("tbody");
    rows.slice(1).forEach((row) => {
      const tableRow = document.createElement("tr");
      row.forEach((cellText) => {
        const cell = document.createElement("td");
        appendInlineMarkdown(cell, cellText);
        tableRow.append(cell);
      });
      body.append(tableRow);
    });
    table.append(body);
  }

  tableWrap.append(table);
  container.append(tableWrap);
  return index;
}

function renderMarkdown(container, text) {
  const lines = text.replace(/\r/g, "").split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }

    if (/^(?:---+|\*\*\*|___)$/.test(line)) {
      container.append(document.createElement("hr"));
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      const element = document.createElement(heading[1].length < 3 ? "h3" : "h4");
      appendInlineMarkdown(element, heading[2]);
      container.append(element);
      index += 1;
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      index = renderMarkdownTable(container, lines, index);
      continue;
    }

    const listMatch = line.match(/^(?:[-*+]\s+|\d+[.)]\s+)/);
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[0]);
      const list = document.createElement(ordered ? "ol" : "ul");
      while (index < lines.length) {
        const item = lines[index].trim().match(/^(?:([-*+])\s+|(\d+)[.)]\s+)(.+)$/);
        if (!item || Boolean(item[2]) !== ordered) break;
        const listItem = document.createElement("li");
        appendInlineMarkdown(listItem, item[3]);
        list.append(listItem);
        index += 1;
      }
      container.append(list);
      continue;
    }

    if (/^(```|~~~)/.test(line)) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^(```|~~~)/.test(lines[index].trim())) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = codeLines.join("\n");
      pre.append(code);
      container.append(pre);
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    const paragraph = document.createElement("p");
    appendInlineMarkdown(paragraph, paragraphLines.join(" "));
    container.append(paragraph);
  }
}

function scrollToLatest() {
  const conversation = document.querySelector("#conversation");
  conversation.scrollTop = conversation.scrollHeight;
}

function showTypingIndicator() {
  const article = document.createElement("article");
  article.className = "message assistant-message";
  article.setAttribute("aria-label", "Wanderwise is thinking");

  const avatar = document.createElement("span");
  avatar.className = "message-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = "✳";

  const content = document.createElement("div");
  content.className = "message-content";
  const indicator = document.createElement("span");
  indicator.className = "typing-indicator";
  indicator.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 3; index += 1) {
    indicator.append(document.createElement("span"));
  }
  content.append(indicator);
  article.append(avatar, content);
  messages.append(article);
  scrollToLatest();
  return article;
}

function getConversationHistory() {
  return Array.from(messages.querySelectorAll(".message"))
    .map((message) => ({
      role: message.classList.contains("user-message") ? "user" : "assistant",
      text: message.dataset.messageText || "",
    }))
    .filter((message) => message.text)
    .slice(-20);
}

function setBusy(isBusy) {
  input.disabled = isBusy;
  sendButton.disabled = isBusy;
  clearButton.disabled = isBusy;
  newTripButton.disabled = isBusy;
  inspirationButton.disabled = isBusy;
  document.querySelectorAll(".suggestion-chip").forEach((button) => {
    button.disabled = isBusy;
  });
  form.setAttribute("aria-busy", String(isBusy));
}

async function sendMessage(text) {
  const message = text.trim();
  if (!message || form.getAttribute("aria-busy") === "true") return;

  addMessage(message, "user");
  suggestions.hidden = true;
  input.value = "";
  input.style.height = "auto";
  setBusy(true);

  const conversation = getConversationHistory()
    .map(({ role, text }) => ({ role, text }));
  const typing = showTypingIndicator();
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: conversation }),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Gemini couldn't complete that request. Please try again.");
    }
    if (typeof result.reply !== "string" || !result.reply.trim()) {
      throw new Error("The chat server returned no reply. Please try again.");
    }
    typing.remove();
    addMessage(result.reply, "assistant");
  } catch (error) {
    typing.remove();
    const message = error instanceof TypeError
      ? "Couldn't connect to Gemini. Check your internet connection and browser access, then try again."
      : error.message || "Couldn't reach the travel assistant. Please try again.";
    addMessage(message, "assistant");
  } finally {
    setBusy(false);
    input.focus();
  }
}

function resetChat() {
  if (form.getAttribute("aria-busy") === "true") return;
  messages.replaceChildren();
  starterMessage.forEach((paragraph) => addMessage(paragraph, "assistant"));
  suggestions.hidden = false;
  input.value = "";
  input.style.height = "auto";
  input.focus();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(input.value);
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 110)}px`;
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

document.querySelectorAll(".suggestion-chip").forEach((button) => {
  button.addEventListener("click", () => sendMessage(button.dataset.prompt || ""));
});

clearButton.addEventListener("click", resetChat);
newTripButton.addEventListener("click", resetChat);

inspirationButton.addEventListener("click", () => {
  sendMessage("Give me some travel inspiration");
});

import { parse } from "node-html-parser";
import { load } from "@std/dotenv";

await load({ export: true });

const WISHLIST_ID = Deno.env.get("WISHLIST_ID");
const MIN_DISCOUNT_PERCENT = Deno.env.get("MIN_DISCOUNT_PERCENT"); // percentage
const BOT_TOKEN = Deno.env.get("BOT_TOKEN");
const BOT_CHAT = Deno.env.get("BOT_CHAT");

const job = async () => {
  if (!WISHLIST_ID || !MIN_DISCOUNT_PERCENT || !BOT_TOKEN || !BOT_CHAT) {
    console.error("Bad config");
    return;
  }

  const sendMessage = async (
    text: string,
    options?: { [key: string]: unknown },
  ) => {
    const body = {
      chat_id: BOT_CHAT,
      text,
      ...options,
    };

    const req = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    if (!req.ok) {
      console.error(await req.json());
    }
  };

  const res = await fetch(`https://www.xbox.com/en-US/wishlist/${WISHLIST_ID}`);
  const text = await res.text();
  const parsed = parse(text);

  const rows = parsed.querySelector("#PageContent div div");

  // HTML has changed
  if (!rows) return;

  // Heading is not needed
  rows.removeChild(rows.childNodes[0]);

  const games = rows.querySelectorAll(
    ".w-75.media-body > div > div:first-child",
  );

  console.debug("Parsed", name, "games");

  const kv = await Deno.openKv();

  for (const game of games) {
    const info = game.querySelectorAll(".row");

    const [name, publisher, priceRaw] = [info[0].text, info[1].text, info[2]];

    const prices = priceRaw
      .querySelectorAll("span")
      .map((x) => x.text)
      .map((x) => x.split("$")[1])
      .map(Number.parseFloat);

    // Already free or has gifting restrictions
    if (priceRaw.text.includes("not eligible") || !prices.length) {
      console.debug(name, "not eligible");
      continue;
    }

    // Regular price
    if (prices.length === 1) {
      console.debug(name, "no discount");
      continue;
    }

    const discount = Math.round((1 - prices[1] / prices[0]) * 100);

    if (discount >= Number.parseInt(MIN_DISCOUNT_PERCENT)) {
      if (!(await kv.get([`${name}-${discount}`])).value) {
        await sendMessage(
          [
            `${name} by ${publisher}`,
            "", // spacer
            `${discount}% ($${prices[0]} -> $${prices[1]})`,
          ].join("\n"),
          { parse_mode: "HTML" },
        );
        await kv.set([`${name}-${discount}`], true);
      }
      console.debug(name, "discounted", `${discount}%`, "sent notification");
    } else {
      console.debug(name, "discounted", `${discount}%`, "already notified");
    }
  }
};

Deno.cron("job", "0 16 * * *", job);

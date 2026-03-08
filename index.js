import axios from "axios";

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

// 1️⃣ Get Spotify Token
async function getSpotifyToken() {
  const response = await axios.post(
    "https://accounts.spotify.com/api/token",
    "grant_type=client_credentials",
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " +
          Buffer.from(
            SPOTIFY_CLIENT_ID + ":" + SPOTIFY_CLIENT_SECRET
          ).toString("base64"),
      },
    }
  );
  return response.data.access_token;
}

// 2️⃣ Search Podcasts
async function searchPodcasts(token) {
  const response = await axios.get(
    "https://api.spotify.com/v1/search",
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      params: {
        q: "psychology OR relationships OR AI",
        type: "show",
        market: "GB",
        limit: 10,
      },
    }
  );
  return response.data.shows.items;
}

// 3️⃣ Send to Notion
async function sendToNotion(show) {
  await axios.post(
    "https://api.notion.com/v1/pages",
    {
      parent: { database_id: NOTION_DATABASE_ID },
      properties: {
        Title: {
          title: [
            {
              text: {
                content: show.name,
              },
            },
          ],
        },
        "Spotify Link": {
          url: show.external_urls.spotify,
        },
        Description: {
          rich_text: [
            {
              text: {
                content: show.description.slice(0, 1000),
              },
            },
          ],
        },
      },
    },
    {
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
      },
    }
  );
}

async function main() {
  const token = await getSpotifyToken();
  const shows = await searchPodcasts(token);

  for (const show of shows) {
    await sendToNotion(show);
  }

  console.log("Done.");
}

main();

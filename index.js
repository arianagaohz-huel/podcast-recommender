import axios from "axios";

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

// Validate environment variables
function validateEnv() {
  const required = [
    "SPOTIFY_CLIENT_ID",
    "SPOTIFY_CLIENT_SECRET",
    "NOTION_TOKEN",
    "NOTION_DATABASE_ID",
  ];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(
        `Missing required environment variable: ${key}`
      );
    }
  }
}

// 1️⃣ Get Spotify Token
async function getSpotifyToken() {
  try {
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
    console.log("✅ Successfully obtained Spotify token");
    return response.data.access_token;
  } catch (error) {
    console.error(
      "❌ Failed to get Spotify token:",
      error.response?.status,
      error.response?.data || error.message
    );
    throw new Error(
      `Spotify authentication failed: ${error.response?.data?.error_description || error.message}`
    );
  }
}

// 2️⃣ Search Podcasts
async function searchPodcasts(token) {
  try {
    const response = await axios.get(
      "https://api.spotify.com/v1/search",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params: {
          q: "psychology OR book recommendation OR book club OR AI OR product managers OR films",
          type: "show",
          market: "GB",
          limit: "50", // Increased limit to get more results for filtering
        },
      }
    );
    console.log(`✅ Found ${response.data.shows.items.length} podcasts`);
    return response.data.shows.items;
  } catch (error) {
    console.error(
      "❌ Failed to search podcasts:",
      error.response?.status,
      error.response?.data || error.message
    );
    throw new Error(
      `Podcast search failed: ${error.message}`
    );
  }
}

// EXCLUSION FILTER: Check if podcast should be excluded
// Filters out:
// - AI-generated podcasts
// - Psychology course/textbook content (e.g., AQA Psychology, A Level Psychology, revision materials)
function shouldExcludePodcast(show) {
  const text = `${show.name} ${show.description || ""}`.toLowerCase();
  
  // Keywords that indicate AI-generated or course content to EXCLUDE
  const excludeKeywords = [
    "ai-generated",
    "ai generated",
    "automatically generated",
    "auto-generated",
    "aqa psychology",
    "a level psychology",
    "a-level psychology",
    "gcse psychology",
    "psychology revision",
    "textbook",
    "study guide",
    "exam prep",
    "course material",
    "educational content for students",
  ];
  
  return excludeKeywords.some(keyword => text.includes(keyword));
}

// Determine podcast genre based on keywords in name and description
function determinePodcastGenre(show) {
  const text = `${show.name} ${show.description || ""}`.toLowerCase();

  // Define genre keywords matching your Notion choices
  const genreKeywords = {
    "Psychology": ["psychology", "mental health", "therapy", "mind", "behavioral"],
    "Book or Films": ["book", "film", "movie", "literature", "cinema", "reading", "author"],
    "AI or Tech": ["ai", "artificial intelligence", "technology", "tech", "machine learning", "algorithm", "software", "programming", "startup"],
    "Product Managers": ["product manager", "product management", "pm", "product strategy", "ux", "user experience"]
  };

  // Score each genre based on keyword matches
  const scores = {};
  for (const [genre, keywords] of Object.entries(genreKeywords)) {
    scores[genre] = keywords.filter(keyword => text.includes(keyword)).length;
  }

  // Find the genre with the highest score
  const highestScoringGenre = Object.entries(scores).sort(([, a], [, b]) => b - a)[0];
  
  // Return the genre if there's a match, otherwise return null
  return highestScoringGenre && highestScoringGenre[1] > 0 ? highestScoringGenre[0] : null;
}

// 3️⃣ Send to Notion
async function sendToNotion(show) {
  try {
    // Handle potentially null or missing description
    const description = show.description
      ? show.description.slice(0, 1000)
      : "No description available";

    // Get current date in ISO format (YYYY-MM-DD)
    const dateAdded = new Date().toISOString().split('T')[0];

    // Determine genre
    const genre = determinePodcastGenre(show);

    // Build properties object
    const properties = {
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
              content: description,
            },
          },
        ],
      },
      "Date Added": {
        date: {
          start: dateAdded,
        },
      },
    };

    // Add genre only if one was determined
    if (genre) {
      properties["Podcast Genre"] = {
        select: {
          name: genre,
        },
      };
      console.log(`🏷️ Genre matched: ${genre}`);
    } else {
      console.log(`⚠️ No genre match found for: ${show.name}`);
    }

    await axios.post(
      "https://api.notion.com/v1/pages",
      {
        parent: { database_id: NOTION_DATABASE_ID },
        properties: properties,
      },
      {
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
        },
      }
    );
    console.log(`✅ Added to Notion: ${show.name}`);
  } catch (error) {
    console.error(
      `❌ Failed to add "${show.name}" to Notion:`,
      error.response?.status,
      error.response?.data || error.message
    );
    throw new Error(
      `Notion API failed for show "${show.name}": ${error.message}`
    );
  }
}

// Filter and organize podcasts into categories with 50/50 ratio
// Target: 10 total podcasts (5 AI/PM + 5 Psychology/Books/Films)
function organizePodcastsByRatio(shows) {
  const TARGET_TOTAL = 10;
  const AI_PM_TARGET = 5;
  const OTHER_TARGET = 5;
  
  const aiPmPodcasts = [];
  const otherPodcasts = [];
  
  for (const show of shows) {
    // Skip excluded podcasts
    if (shouldExcludePodcast(show)) {
      console.log(`⏭️  Skipping excluded podcast: ${show.name}`);
      continue;
    }
    
    const genre = determinePodcastGenre(show);
    
    // Categorize by genre
    if (genre === "AI or Tech" || genre === "Product Managers") {
      if (aiPmPodcasts.length < AI_PM_TARGET) {
        aiPmPodcasts.push(show);
      }
    } else if (genre === "Psychology" || genre === "Book or Films") {
      if (otherPodcasts.length < OTHER_TARGET) {
        otherPodcasts.push(show);
      }
    }
    
    // Stop when we have enough podcasts
    if (aiPmPodcasts.length >= AI_PM_TARGET && otherPodcasts.length >= OTHER_TARGET) {
      break;
    }
  }
  
  const selectedPodcasts = [...aiPmPodcasts, ...otherPodcasts];
  
  console.log(`\n📊 Podcast Ratio Summary:`);
  console.log(`   AI/Product Manager: ${aiPmPodcasts.length}/${AI_PM_TARGET}`);
  console.log(`   Psychology/Books/Films: ${otherPodcasts.length}/${OTHER_TARGET}`);
  console.log(`   Total Selected: ${selectedPodcasts.length}/${TARGET_TOTAL}\n`);
  
  return selectedPodcasts;
}

async function main() {
  try {
    console.log("🚀 Starting podcast recommendation workflow...");

    // Validate environment variables first
    validateEnv();
    console.log("✅ All required environment variables are set");

    // Get token and search
    const token = await getSpotifyToken();
    const shows = await searchPodcasts(token);

    // Filter and organize podcasts by ratio (50/50 split)
    const selectedPodcasts = organizePodcastsByRatio(shows);
    
    if (selectedPodcasts.length === 0) {
      console.warn("⚠️  No suitable podcasts found after filtering and ratio adjustment");
      process.exit(0);
    }

    // Send to Notion
    console.log(`📝 Sending ${selectedPodcasts.length} podcasts to Notion...`);
    for (const show of selectedPodcasts) {
      await sendToNotion(show);
    }

    console.log("✨ Done! All podcasts added to Notion.");
  } catch (error) {
    console.error("\n🛑 Workflow failed:");
    console.error(error.message);
    process.exit(1);
  }
}

main();

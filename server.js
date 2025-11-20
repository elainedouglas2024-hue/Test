import express from "express";
import pg from "pg";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// CORS (set your domain later)
app.use(cors({
  origin: "https://yourdomain.com",  // <-- change later
  methods: ["GET", "POST"],
  credentials: true
}));

app.use(express.json());

// Connect to PostgreSQL
const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

db.connect();

// -----------------------------
//   REFERRAL SYSTEM ENDPOINTS
// -----------------------------

// Create user with optional referral code
app.post("/register", async (req, res) => {
  const { username, referral } = req.body;

  try {
    // Create unique referral code for new user
    const myCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    // Insert user
    const newUser = await db.query(
      "INSERT INTO users (username, my_code, referrals, referred_by) VALUES ($1, $2, 0, $3) RETURNING my_code",
      [username, myCode, referral || null]
    );

    // If user used a referral → reward referrer
    if (referral) {
      await db.query(
        "UPDATE users SET referrals = referrals + 1 WHERE my_code = $1",
        [referral]
      );
    }

    res.json({
      success: true,
      referral_code: newUser.rows[0].my_code
    });

  } catch (err) {
    console.error(err);
    res.json({ success: false, error: err.message });
  }
});

// Get referral link for a user
app.get("/ref/:code", (req, res) => {
  const code = req.params.code;
  res.json({
    code,
    link: `https://yourdomain.com/?ref=${code}`
  });
});

// Health check
app.get("/", (req, res) => {
  res.send("Referral backend running.");
});

// Start server on Railway port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

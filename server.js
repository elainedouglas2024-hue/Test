import express from "express";
import pg from "pg";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST"]
}));

app.use(express.json());

// PostgreSQL connection
const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

db.connect()
  .then(() => console.log("Connected to Railway PostgreSQL"))
  .catch(err => console.error("DB connection error:", err));


// -----------------------------
// REGISTER USER
// -----------------------------
app.post("/register", async (req, res) => {
  const { username, referral } = req.body;

  try {
    const myCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    const newUser = await db.query(
      "INSERT INTO users (username, my_code, referrals, referred_by) VALUES ($1, $2, 0, $3) RETURNING my_code",
      [username, myCode, referral || null]
    );

    if (referral) {
      const exists = await db.query(
        "SELECT * FROM users WHERE my_code = $1 LIMIT 1",
        [referral]
      );

      if (exists.rowCount > 0) {
        await db.query(
          "UPDATE users SET referrals = referrals + 1 WHERE my_code = $1",
          [referral]
        );
      }
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


// -----------------------------
// REFERRAL LINK
// -----------------------------
app.get("/ref/:code", (req, res) => {
  const code = req.params.code;

  res.json({
    code,
    link: `https://yourdomain.com/?ref=${code}`
  });
});


// HEALTH CHECK
app.get("/", (req, res) => {
  res.send("Referral backend running.");
});


// START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

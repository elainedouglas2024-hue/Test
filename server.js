// server.js
import express from "express";
import pg from "pg";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"] }));
app.use(express.json());

// Use Pool for connection pooling in production
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// referral reward amounts (USDT) per level
const REWARD_LEVELS = {
  1: 1.0,   // direct (level 1)
  2: 0.5,   // level 2
  3: 0.2    // level 3
};

// simple level thresholds (example)
function computeLevel(referralsCount) {
  if (referralsCount >= 30) return 3;
  if (referralsCount >= 10) return 2;
  return 1;
}

// generate a random referral code and ensure uniqueness
async function generateUniqueCode(client, tries = 10) {
  for (let i = 0; i < tries; i++) {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const { rowCount } = await client.query(
      `SELECT 1 FROM users WHERE referral_code = $1 LIMIT 1`,
      [code]
    );
    if (rowCount === 0) return code;
  }
  // fallback - if collision problem, append timestamp
  return `C${Date.now().toString(36).toUpperCase()}`;
}

// -----------------------------
// Register endpoint (with multi-level payouts)
// -----------------------------
app.post("/register", async (req, res) => {
  const { username, referral } = req.body ?? {};

  if (!username || typeof username !== "string" || username.trim() === "") {
    return res.status(400).json({ success: false, error: "username is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // generate unique code
    const referralCode = await generateUniqueCode(client);

    // Insert new user
    const insertText = `
      INSERT INTO users (username, referral_code, referred_by, referrals, earnings_usdt, level, created_at)
      VALUES ($1, $2, $3, 0, 0, 1, CURRENT_DATE)
      RETURNING id, referral_code, username, referred_by, referrals, earnings_usdt, level, created_at
    `;
    const insertValues = [username.trim(), referralCode, referral || null];
    const insertResult = await client.query(insertText, insertValues);
    const newUser = insertResult.rows[0];

    // If a referral code was provided, process rewards up to 3 levels
    if (referral) {
      // level 1: the immediate referrer (user whose referral_code = referral)
      let currentCode = referral;
      for (let level = 1; level <= 3; level++) {
        if (!currentCode) break;

        // find referrer by referral_code
        const refQ = await client.query(
          `SELECT id, referral_code, referrals, earnings_usdt, referred_by
           FROM users
           WHERE referral_code = $1
           LIMIT 1`, [currentCode]
        );

        if (refQ.rowCount === 0) {
          // invalid code — stop chain
          break;
        }

        const refUser = refQ.rows[0];

        // compute reward for this level
        const reward = REWARD_LEVELS[level] || 0;

        // update this referrer's referrals count (only for level 1 we increase direct referrals count)
        // For clarity: referrals column tracks direct referrals (people who used their code)
        if (level === 1) {
          await client.query(
            `UPDATE users
             SET referrals = referrals + 1
             WHERE id = $1`,
            [refUser.id]
          );
        }

        // update earnings for this referrer
        await client.query(
          `UPDATE users
           SET earnings_usdt = earnings_usdt + $1
           WHERE id = $2`,
          [reward, refUser.id]
        );

        // recompute and set level for this referrer based on their updated referrals count
        const rc = await client.query(`SELECT referrals FROM users WHERE id = $1`, [refUser.id]);
        const newRefCount = rc.rows[0]?.referrals ?? 0;
        const newLevel = computeLevel(newRefCount);
        if (newLevel !== refUser.level) {
          await client.query(`UPDATE users SET level = $1 WHERE id = $2`, [newLevel, refUser.id]);
        }

        // move up the chain: next code is this referrer's referred_by (their parent code)
        currentCode = refUser.referred_by;
      }
    }

    await client.query("COMMIT");

    // Return details about the new user (and a simple message). Do NOT return sensitive info.
    return res.json({
      success: true,
      user: {
        id: newUser.id,
        username: newUser.username,
        referral_code: newUser.referral_code,
        referred_by: newUser.referred_by,
        referrals: newUser.referrals,
        earnings_usdt: newUser.earnings_usdt,
        level: newUser.level,
        created_at: newUser.created_at
      },
      message: referral ? "User created and referral chain updated (if valid codes)." : "User created."
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Register error:", err);
    return res.status(500).json({ success: false, error: err.message || "Server error" });
  } finally {
    client.release();
  }
});

// -----------------------------
// Get referral link/info
// -----------------------------
app.get("/ref/:code", async (req, res) => {
  const code = req.params.code;
  if (!code) return res.status(400).json({ success: false, error: "code required" });

  try {
    // find user by code
    const q = await pool.query(
      `SELECT id, username, referral_code, referrals, earnings_usdt, level FROM users WHERE referral_code = $1 LIMIT 1`,
      [code]
    );
    if (q.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Referral code not found" });
    }
    const u = q.rows[0];
    return res.json({
      success: true,
      code: u.referral_code,
      username: u.username,
      referrals: u.referrals,
      earnings_usdt: u.earnings_usdt,
      level: u.level,
      link: `${process.env.FRONTEND_DOMAIN || "https://yourdomain.com"}/?ref=${u.referral_code}`
    });
  } catch (err) {
    console.error("Ref lookup error:", err);
    return res.status(500).json({ success: false, error: err.message || "Server error" });
  }
});

// health
app.get("/", (req, res) => res.send("Referral backend running"));

// start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));

import express from "express";
import pg from "pg";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors({ origin: "*", methods: ["GET", "POST"] }));
app.use(express.json());

// -----------------------------
// POSTGRES CONNECTION
// -----------------------------
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
    // Generate referral code
    const myCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    // Insert user into database
    const newUser = await db.query(
      `INSERT INTO users 
        (username, referral_code, referred_by, earnings_usdt, referrals, level)
       VALUES ($1, $2, $3, 0, 0, 1)
       RETURNING id, referral_code`,
      [username, myCode, referral || null]
    );

    // Count referral
    if (referral) {
      await db.query(
        "UPDATE users SET referrals = referrals + 1 WHERE referral_code = $1",
        [referral]
      );
    }

    res.json({
      success: true,
      referral_code: newUser.rows[0].referral_code,
      user_id: newUser.rows[0].id
    });

  } catch (err) {
    console.error(err);
    res.json({ success: false, error: err.message });
  }
});


// -----------------------------
// RECHARGE + 3 LEVEL COMMISSION
// -----------------------------
app.post("/recharge", async (req, res) => {
  const { user_id, amount } = req.body;

  try {
    // Save recharge record
    await db.query(
      "INSERT INTO recharges (user_id, amount) VALUES ($1, $2)",
      [user_id, amount]
    );

    // Get the user's inviter
    const user = await db.query(
      "SELECT referred_by FROM users WHERE id = $1 LIMIT 1",
      [user_id]
    );

    if (user.rowCount === 0) {
      return res.json({ success: false, message: "User not found" });
    }

    const level1_code = user.rows[0].referred_by;

    // ------------------------------------
    // LEVEL 1 — 13%
    // ------------------------------------
    if (level1_code) {
      const lv1 = await db.query(
        "SELECT id, referred_by FROM users WHERE referral_code = $1 LIMIT 1",
        [level1_code]
      );

      if (lv1.rowCount > 0) {
        const lv1_id = lv1.rows[0].id;
        const bonus1 = amount * 0.13;

        await db.query(
          "UPDATE users SET earnings_usdt = earnings_usdt + $1 WHERE id = $2",
          [bonus1, lv1_id]
        );

        const level2_code = lv1.rows[0].referred_by;

        // ------------------------------------
        // LEVEL 2 — 2%
        // ------------------------------------
        if (level2_code) {
          const lv2 = await db.query(
            "SELECT id, referred_by FROM users WHERE referral_code = $1 LIMIT 1",
            [level2_code]
          );

          if (lv2.rowCount > 0) {
            const lv2_id = lv2.rows[0].id;
            const bonus2 = amount * 0.02;

            await db.query(
              "UPDATE users SET earnings_usdt = earnings_usdt + $1 WHERE id = $2",
              [bonus2, lv2_id]
            );

            const level3_code = lv2.rows[0].referred_by;

            // ------------------------------------
            // LEVEL 3 — 1%
            // ------------------------------------
            if (level3_code) {
              const lv3 = await db.query(
                "SELECT id FROM users WHERE referral_code = $1 LIMIT 1",
                [level3_code]
              );

              if (lv3.rowCount > 0) {
                const lv3_id = lv3.rows[0].id;
                const bonus3 = amount * 0.01;

                await db.query(
                  "UPDATE users SET earnings_usdt = earnings_usdt + $1 WHERE id = $2",
                  [bonus3, lv3_id]
                );
              }
            }
          }
        }
      }
    }

    res.json({
      success: true,
      message: "Recharge processed + referral bonuses sent"
    });

  } catch (err) {
    console.error(err);
    res.json({ success: false, error: err.message });
  }
});


// -----------------------------
// ROOT
// -----------------------------
app.get("/", (req, res) => {
  res.send("Referral backend running.");
});


// -----------------------------
// START SERVER
// -----------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

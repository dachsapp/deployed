require("dotenv").config();

// EXPRESS

const express = require("express");
const app = express();

const port = 4334;
const hostname = "0.0.0.0";

const bodyParser = require("body-parser");
app.use(bodyParser.json());

app.use("/", express.static("public"));
app.listen(port, hostname, () => {
  console.log(`Listening on http://${hostname}:${port}`);
});

// NEDB SETUP

const Datastore = require("nedb");
const db = new Datastore("users.db");
db.loadDatabase();

//? adds user to database
const addUser = (userEmail, password, verifyCode, callback) => {
  db.insert(
    {
      email: userEmail,
      password: password,
      status: "not-logged-in",
      verifyCode: verifyCode,
      timeout: "verify",
      coins: 500,
      itemsBought: [],
      itemsCollected: [],
    },
    callback
  );
};

// NODEMAILER

const nodemailer = require("nodemailer");
const getVerifyCode = () => {
  const useableSympoles =
    "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let verifyCode = "";
  for (let i = 1; i <= 6; i++) {
    verifyCode =
      verifyCode +
      useableSympoles[Math.floor(Math.random() * useableSympoles.length)];
  }
  return verifyCode;
};

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL,
    pass: process.env.PASSWORD,
  },
});

// SENDMAIL

let verifyCode;
const sendMail = (userEmail, callback) => {
  verifyCode = getVerifyCode();
  transporter
    .sendMail({
      from: process.env.EMAIL,
      to: userEmail,
      subject: "Dachsapp Bestätigungscode",
      html: `
	  <div>
	  <h1>Bestätigungscode</h1>
	  <pre>
	  Ihr Code lautet: ${verifyCode}
	  </pre>
	  <h3>Danke<br>Ihr Dachsteam</h3>
	  </div>`,
    })
    .then((res) => {
      console.log(`Got sended to ${userEmail} successfully`);
      callback(verifyCode);
    })
    .catch((err) => {
      console.log(`Couldn't send email to ${userEmail}`);
      callback("error: " + err);
    });
};

// IS FUNCTIONS

const isEmailRegistered = (userEmail, callback) => {
  //? get all users
  db.find({}, (err, allUsers) => {
    for (let user of allUsers) {
      if (user.email.toLowerCase() === userEmail.toLowerCase()) {
        callback(true);
        return;
      }
    }
    callback(false);
  });
};

const isPasswordCorrect = (userData, callback) => {
  db.find({}, (err, allUsers) => {
    for (let user of allUsers) {
      if (user.email.toLowerCase() === userData.email.toLowerCase()) {
        callback(user.password === userData.password ? true : false);
        return;
      }
    }
    callback("The user isn't correct!!!");
  });
};

const isPasswordUseable = (userPassword, callback) => {
  let isUseable = true;
  if (userPassword.length < 6) isUseable = false;
  if (userPassword.length > 32) isUseable = false;
  for (let letter of userPassword) {
    if (
      !"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789~!@#$%^&*()_-=+{}[]|;:/?.`'".includes(
        letter
      )
    ) {
      isUseable = false;
    }
  }
  callback(isUseable);
};

//? remove user if not verified before 3 minutes have passed
const handleVerifyTimeout = (userEmail) => {
  db.find({ email: userEmail }, (err, user) => {
    if (user[0] === undefined || err) {
      console.log("Wait, whaaaat?!");
      return;
    }
    setTimeout(() => {
      db.find({ email: userEmail }, (err, newUser) => {
        if (newUser[0] === undefined) return;
        console.log(newUser[0].timeout);
        if (newUser[0].timeout !== "none") {
          db.update(
            { email: userEmail },
            { $set: { timeout: "no-verify" } },
            (err) => console.error(err)
          );
        }
      });
    }, 1 * 60000);
  });
};

// POST REQUESTS

//? handles signup request, so when login/register is clicked
app.post("/serverside/signup", async (req, res) => {
  isEmailRegistered(req.body.email, (isRegistered) => {
    if (isRegistered) {
      isPasswordCorrect(req.body, (isCorrect) => {
        if (isCorrect) {
          db.update(
            { email: req.body.email },
            { $set: { status: "logged-in" } },
            (err) => console.error(err)
          );

          res.json({ message: "login-success" });
          return;
        }
        res.json({ message: "login-nosuccess" });
      });
      return;
    }
    isPasswordUseable(req.body.password, async (isUseable) => {
      if (isUseable) {
        //TODO register and login, goto lobby
        sendMail(req.body.email, (verifyCode) => {
          if (verifyCode.includes("error: ")) {
            res.json({ message: "email-not-sent" });
            return;
          }

          addUser(req.body.email, req.body.password, verifyCode, (err) => {
            handleVerifyTimeout(req.body.email);
            if (err) {
              console.error(err);
              res.json({ message: "user-not-added" });
              return;
            }
            res.json({ message: "verify-code-waiting" });
          });
        });
        return;
      }
      res.json({ message: "register-pass-illegal" });
    });
  });
});

//? returnes 'logged-in' or 'not-logged-in'
app.post("/serverside/getStatus", (req, res) => {
  if (req.body.email === "") {
    res.json({ message: "not-logged-in" });
    return;
  }
  db.find({ email: req.body.email }, (err, user) => {
    if (user[0] === undefined) {
      console.log("Not a registered email");
      res.json({ message: "not-logged-in" });
      return;
    }
    res.json({ message: user[0].status });
  });
});

app.post("/serverside/check-verify-code", (req, res) => {
  db.find({ email: req.body.email }, (err, user) => {
    if (user[0] === undefined) {
      console.log("Error: User not found!");
      res.json({ message: "user-not-found" });
      return;
    }
    if (user[0].timeout === "no-verify") {
      res.json({ message: "timed-out-verify" });
      db.remove({ email: req.body.email }, {}, (err) => console.error(err));
      return;
    }
    if (user[0].verifyCode === req.body.code) {
      db.update(
        { email: req.body.email },
        { $set: { timeout: "none", status: "logged-in", verifyCode: "none" } },
        (err) => {
          if (err) {
            console.error(err);
          }
          res.json({ message: "code-correct" });
        }
      );
    } else {
      res.json({
        message: "code-not-correct",
      });
    }
  });
});

// GET-USERS-ITEMS/COINS

app.post("/serverside/get-user-coins", (req, res) => {
  db.find({ email: req.body.email }, (err, user) => {
    if (err) {
      console.error(err);
      return;
    }
    if (user[0] !== undefined) {
      res.json({ message: user[0].coins });
    }
  });
});
app.post("/serverside/get-collected-items", (req, res) => {
  db.find({ email: req.body.email }, (err, user) => {
    if (err) {
      console.error(err);
      return;
    }
    if (user[0] !== undefined) {
      res.json({ message: user[0].itemsCollected });
    }
  });
});
app.post("/serverside/get-bought-items", (req, res) => {
  db.find({ email: req.body.email }, (err, user) => {
    if (err) {
      console.error(err);
      return;
    }
    if (user[0] !== undefined) {
      res.json({ message: user[0].itemsBought });
    }
  });
});

// SETS/ADDES_TO-USERS-ITEMS/COINS

app.post("/serverside/set-user-coins", (req, res) => {
  db.find({ email: req.body.email }, (err, user) => {
    if (err) {
      console.error(err);
      return;
    }
    db.update(
      { email: req.body.email },
      { $set: { coins: req.body.coins } },
      (err) => console.log(err ? new Error(err) : " ")
    );
  });
});
app.post("/serverside/addto-collected-items", (req, res) => {
  db.find({ email: req.body.email }, (err, user) => {
    if (err) {
      console.error(err);
      return;
    }
    if (user[0] !== undefined) {
      const oldItems = user[0].itemsCollected;
      db.update(
        { email: req.body.email },
        { $set: { itemsCollected: [...oldItems, req.body.item] } },
        (err) => console.log(err ? new Error(err) : " ")
      );
    }
  });
});
app.post("/serverside/addto-bought-items", (req, res) => {
  db.find({ email: req.body.email }, (err, user) => {
    if (err) {
      console.error(err);
      return;
    }
    if (user[0] !== undefined) {
      const oldItems = user[0].itemsBought;
      db.update(
        { email: req.body.email },
        { $set: { itemsBought: [...oldItems, req.body.item] } },
        (err) => console.log(err ? new Error(err) : " ")
      );
    }
  });
});

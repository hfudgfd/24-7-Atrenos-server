const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Search</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      background: #111;
      color: #fff;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      font-family: Arial, sans-serif;
    }
    input {
      width: 300px;
      padding: 12px;
      font-size: 18px;
      border-radius: 8px;
      border: none;
      outline: none;
    }
    button {
      padding: 12px 16px;
      font-size: 18px;
      margin-left: 8px;
      border-radius: 8px;
      border: none;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <form action="https://duckduckgo.com/" method="get">
    <input name="q" placeholder="Search DuckDuckGo" autofocus />
    <button type="submit">Search</button>
  </form>
</body>
</html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0");

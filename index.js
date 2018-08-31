require('dotenv').config();
const path = require('path');
var express = require('express');
const bodyParser = require('body-parser');
var app = express();
var http = require('http').Server(app);
const dist = path.resolve('./src');
const axios = require('axios');
const redirect_uri = process.env.REDIRECT_URI || 'https://gloot-utils.herokuapp.com/oauth2';
const uuidv1 = require('uuid/v1');
var tokens = { };
var states = { };

app.use(bodyParser.json(), express.static(dist));

/** Generates a login url for a specific User.
 * 
 * Call this from within a /slack command in order to generate
 * a login button in the response message.
 *
 * @param string user - The slack verified user
 */
var generateLoginUrl = function(user) {
  const state = uuidv1();
  states[state] = user;
  var path = '/oauth2/authorize?redirect_uri=' + redirect_uri + '&response_type=code&client_id=gloot-utils&scope=SUPER_USER&state=' + state;
  return process.env.API_BASE_PATH + path;
}

/** This is only here for debugging purposes.
 * Normally the login flow is initiated from within a /slack command
 * and only #generateLoginUrl(user) would be called.
 */
app.get('/login', function(req, res) {
  const { user } = req.query;
  res.status(200).json({ redirect_uri : generateLoginUrl(user) });
});

/** Handles the oauth2 authorization_code stage.
 * 
 * -- Do NOT change this url --
 *
 * Only this specific redirect url is allowed for the client 'gloot-utils'
 */
app.get('/oauth2', function(req, res) {
  const { code, state } = req.query;
  const user = states[state];
  delete states[state];

  if (!user) {
    res.status(403).json({error : "Invalid state"});
  }

  if (code) {
    var urlPath = '/oauth2/token?grant_type=authorization_code&code=' + code + '&redirect_uri=' + redirect_uri + '&client_id=gloot-utils';
    var options = {
      method : "POST",
      url : process.env.API_BASE_PATH + urlPath,
      data: '',
      headers: {
        'Authorization' : 'Basic Z2xvb3QtdXRpbHM6ankqKylxKDRqQ0U/VlQ0ZQ=='
      }
    }
    axios(options)
    .then(response => {
      tokens[user] = response.data.access_token;
      res.sendFile(path.join(dist, 'logged_in.html'));
    })
    .catch(error => {
      console.log(error);
      res.status(403);
    });
    }
});

app.get('*', function(req, res) {
  res.sendFile(path.join(dist, 'index.html'));
});

http.listen(process.env.PORT || 8888, function() {
  console.log(`listening on *:${process.env.PORT}`);
});

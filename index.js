require('dotenv').config();
const { createMessageAdapter } = require('@slack/interactive-messages');
const path = require('path');
var express = require('express');
const bodyParser = require('body-parser');
var app = express();
var http = require('http').Server(app);
const dist = path.resolve('./src');
const axios = require('axios');
const redirect_uri = process.env.REDIRECT_URI || 'https://gloot-utils.herokuapp.com/oauth2';
const API_BASE_PATH = process.env.API_BASE_PATH || 'https://api.gloot.com';
const uuidv1 = require('uuid/v1');
const jwtDecode = require('jwt-decode');
const rawBodySaver = require('./raw-body').rawBodySaver;
const { slackSignatureValidation, slack } = require('./gloot-slack');

var tokens = { };
var states = { };

const slackLoggedInMiddleware = slack({login: true}, (user) => tokens[user], (user, url) => generateLoginUrl(user, url));
app.use(bodyParser.json({verify: rawBodySaver}), express.static(dist));
app.use(bodyParser.urlencoded({verify: rawBodySaver, extended: false}));

var saveTokenForUser = function(user, token) {
  tokens[user] = token;
}

/** Generates a login url for a specific User.
 * 
 * Call this from within a /slack command in order to generate
 * a login button in the response message.
 *
 * @param string user - The slack verified user
 */
var generateLoginUrl = function(user, responseUrl) {
  const state = uuidv1();
  states[state] = {user : user, responseUrl : responseUrl};
  console.log(arguments);
  var path = '/oauth2/authorize?redirect_uri=' + redirect_uri + '&response_type=code&client_id=gloot-utils&scope=SUPER_USER&state=' + state;
  return API_BASE_PATH + path;
}

app.post('/slack/glogin', slackLoggedInMiddleware, function(req, res) {
  res.status(200).json({text : generateLoginUrl(req.body.user_id, req.body.response_url)});
});

var respond = function(url, data) {
  var options = {
    method : "POST",
    url : url,
    data: data,
    headers: {
      'Content-Type' : 'application/json'
    }
  }
  return axios(options);
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
  console.log(states);
  console.log(req.query);
  console.log(states[state]);
  const {user, responseUrl} = states[state];
  if (states[state])
    delete states[state];

  if (!user) {
    res.status(403).json({error : "Invalid state, user=" + user + ", response_url = " + responseUrl});
  }

  if (code) {
    var urlPath = '/oauth2/token?grant_type=authorization_code&code=' + code + '&redirect_uri=' + redirect_uri + '&client_id=gloot-utils';
    var options = {
      method : "POST",
      url : API_BASE_PATH + urlPath,
      data: '',
      headers: {
        'Authorization' : 'Basic Z2xvb3QtdXRpbHM6ankqKylxKDRqQ0U/VlQ0ZQ=='
      }
    }
    axios(options)
      .then(response => {
        saveTokenForUser(user, response.data.access_token);
        console.log(response.data);
        const claims = jwtDecode(response.data.access_token);
        console.log(claims);
        if (responseUrl) {
          respond(responseUrl, {
            text: 'You are logged in', attachments: [
              {
                text : claims.username,
                footer : claims.email + " - " + claims.glootId,
                footer_icon : claims.avatar
              }
            ]
          })
            .then(() => {
              res.sendFile(path.join(dist, 'logged_in.html'));
            })
            .catch(error => {
              res.status(500).json({ error: error });
            })
        } else {
          res.sendFile(path.join(dist, 'logged_in.html'));
        }
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

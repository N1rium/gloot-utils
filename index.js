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
const { slackSignatureValidation, slackMiddleware, slack } = require('./gloot-slack');

var tokens = { };
var states = { };

app.use(bodyParser.json({verify: rawBodySaver}), express.static(dist));
app.use(bodyParser.urlencoded({verify: rawBodySaver, extended: false}));
app.use(slackMiddleware({ tokenProvider: (user) => tokens[user], loginUrlProvider: (user, url) => generateLoginUrl(user, url) }));

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
  let path = '/oauth2/authorize?redirect_uri=' + redirect_uri + '&response_type=code&client_id=gloot-utils&scope=SUPER_USER&state=' + state;
  return API_BASE_PATH + path;
}

var handleError = function(error, url) {
  if (error && error.response && error.response.data)
    error = error.response.data;

  if (!url) {
    console.log(error);
    return;
  }

  respond(url, {attachments : [
    {
      title: "Error",
      text: JSON.stringify(error),
      footer: "Error from the server"
    }
  ]});
}

slack.addRoute({path : "/slack/glogin", login: true, handler: (req, res) => {
  res.status(200).json({text : generateLoginUrl(req.body.user_id, req.body.response_url)});
}});

slack.addRoute({path : "/slack/whoami", login: true, handler: (req, res) => {
  res.status(200).json({text : "Fetching user data"});
  callAPI(req, "GET", "/user", '').then(response => {
    respond(req.body.response_url, {attachments: [{
      title: response.data.username,
      text: JSON.stringify(response.data)
    }]});
  }).catch(error => handleError(error, req.body.response_url));
}});

slack.addRoute({path : "/slack/guser", login: false, handler: (req, res) => {
  console.log(tokens, tokens);
  res.status(200).json({text : "Fetching user data"});
  callAPI(req, "GET", "/user/" + req.body.text.trim(), '').then(response => {
    respond(req.body.response_url, {attachments: [{
      title: response.data.username,
      text: JSON.stringify(response.data)
    }]});
  }).catch(error => handleError(error, req.body.response_url));
}});

slack.addRoute({path : "/slack/guserFull", login: true, handler: (req, res) => {
  console.log(tokens, tokens);
  res.status(200).json({text : "Fetching user data"});
  callAPI(req, "POST", "/user/search/findByIds/full", [req.body.text]).then(response => {
    respond(req.body.response_url, {attachments: [{
      title: (response.data.length > 0) ? response.data[0].username : "No user found",
      text: JSON.stringify(response.data)
    }]});
  }).catch(error => handleError(error, req.body.response_url));
}});

slack.addRoute({path : "/slack/gaddRole", login: true, handler: (req, res) => {
  console.log(tokens, tokens);
  res.status(200).json({text : "Adding role"});
  let p = req.body.text.split(" ");
  callAPI(req, "POST", "/roles/" + p[0] + "/" + p[1], '').then(response => {
    respond(req.body.response_url, {attachments: [{
      title: "Role added",
      text: JSON.stringify(response.data)
    }]});
  }).catch(error => handleError(error, req.body.response_url));
}});

slack.addRoute({path : "/slack/gdelRole", login: true, handler: (req, res) => {
  console.log(tokens, tokens);
  res.status(200).json({text : "Adding role"});
  let p = req.body.text.split(" ");
  callAPI(req, "DELETE", "/roles/" + p[0] + "/" + p[1], '').then(response => {
    respond(req.body.response_url, {attachments: [{
      title: "Role added",
      text: JSON.stringify(response.data)
    }]});
  }).catch(error => handleError(error, req.body.response_url));
}});

var callAPI = function (req, method, path, data) {
  let headers = {};
  if (req.token)
    headers.Authorization = "Bearer " + req.token;

  let options = {
    method: method,
    url: API_BASE_PATH + "/api/v1" + path,
    data: data,
    headers
  }
  console.log(options);
  console.log(JSON.stringify(options));
  console.log("kuk");
  return axios(options);
}

var respond = function(url, data) {
  if (!url) {
    console.log(data);
    return;
  }
  let options = {
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
    let urlPath = '/oauth2/token?grant_type=authorization_code&code=' + code + '&redirect_uri=' + redirect_uri + '&client_id=gloot-utils';
    let options = {
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

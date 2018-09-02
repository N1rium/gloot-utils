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
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || '5902a6952b267a565aca98f81f601398';
const uuidv1 = require('uuid/v1');
const crypto = require('crypto');
// Create the adapter using the app's signing secret, read from environment variable
//const slackInteractions = createMessageAdapter(process.env.SLACK_SIGNING_SECRET);

var tokens = { };
var states = { };

function rawBody(req, res, next) {
  req.setEncoding('utf8');
  req.rawBody = '';
  req.on('data', function(chunk) {
    req.rawBody += chunk;
  });
  req.on('end', function(){
    next();
  });
}

app.use(rawBody, bodyParser.json(), express.static(dist));

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
  var path = '/oauth2/authorize?redirect_uri=' + redirect_uri + '&response_type=code&client_id=gloot-utils&scope=SUPER_USER&state=' + state;
  return process.env.API_BASE_PATH + path;
}

//app.use('/slack/interactions', slackInteractions.expressMiddleware());

app.post('/slack/glogin', function(req, res) {
  const timestamp = req.headers['x-slack-request-timestamp'];
  const signature = req.headers['x-slack-signature'];

  if ((new Date().getTime() / 1000) - timestamp > 60 * 5) {
    res.status(200).json({text : "ERROR: Replaying not allowed"});
    return;
  }
  
  const string = 'v0:' + timestamp + ':' + req.rawBody;
  const expectedSignature = 'v0=' + crypto.createHmac('sha256', SLACK_SIGNING_SECRET)
                   .update(string)
                   .digest('hex');

  if (signature != expectedSignature) {
    res.status(200).json({text : "ERROR: Invalid signature", attachments: [
      {text : "Expected: " + expectedSignature},
      {text : "Provided: " + signature},
      {text : "Payload: " + string}
    ]});
    return;
  }

  res.status(200).json({text : generateLoginUrl(req.params.user_id, req.params.response_url)});
 /*
 token=gIkuvaNzQIHg97ATvDxqgjtO
&team_id=T0001
&team_domain=example
&enterprise_id=E0001
&enterprise_name=Globular%20Construct%20Inc
&channel_id=C2147483705
&channel_name=test
&user_id=U2147483697
&user_name=Steve
&command=/weather
&text=94070
&response_url=https://hooks.slack.com/commands/1234/5678
&trigger_id=13345224609.738474920.8088930838d88f008e0
*/
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
  axios(options);
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
  const {user, response_url} = states[state];
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
      respond(response_url, {text : 'You are logged in as: ' + response.data.user.username + " - " + response.data.user.email});
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

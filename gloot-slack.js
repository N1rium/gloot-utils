'use strict';

const crypto = require('crypto');
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || '5902a6952b267a565aca98f81f601398';

var Slack = function (options) {
    var routes = {};
    this.addRoute = function (route) {
        routes[route.path] = {
            login: route.login,
            handler: route.handler
        };
    };
    this.route = function (req, res, tokenProvider, loginUrlProvider, next) {
        var route = routes[req.path];
        if (!route)
            next();
        else {
            exports.slackSignatureValidation(req, res, () => {
                req.token = tokenProvider(req.body.user_id);
                if (route.login && !req.token) {
                    res.status(200).json({
                        attachments: [
                            {
                                "title": "Login required",
                                "text": loginUrlProvider(req.body.user_id, req.body.response_url)
                            }
                        ]
                    });
                    return; // skip next
                }

                route.handler(req, res);
                return;
            });
        }
    }
};

var slack = new Slack();

exports.slack = slack;

exports.slackMiddleware = function (options) {
    return function (req, res, next) {
        slack.route(req, res, options.tokenProvider, options.loginUrlProvider, next);
    }
};

exports.slackSignatureValidation = function (req, res, next) {
    const timestamp = req.headers['x-slack-request-timestamp'];
    const signature = req.headers['x-slack-signature'];

    if ((new Date().getTime() / 1000) - timestamp > 60 * 5) {
        res.status(200).json({ text: "ERROR: Replaying not allowed" });
        return;
    }

    const string = 'v0:' + timestamp + ':' + req.rawBody;
    const expectedSignature = 'v0=' + crypto.createHmac('sha256', SLACK_SIGNING_SECRET)
        .update(string)
        .digest('hex');

    if (signature != expectedSignature) {
        res.status(200).json({
            text: "ERROR: Invalid signature", attachments: [
                { text: "Expected: " + expectedSignature },
                { text: "Provided: " + signature },
                { text: "Payload: " + string }
            ]
        });
        return;
    }
    next();
}

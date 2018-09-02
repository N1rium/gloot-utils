'use strict';

const crypto = require('crypto');
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || '5902a6952b267a565aca98f81f601398';

exports.slack = function (options, tokenProvider, loginUrlProvider) {
    return function(req, res, next) {
        exports.slackSignatureValidation(req, res, () => {
            req.token = tokenProvider(req.body.slack_user);
            console.log(req.body);
            if (options.login && !req.token) {
                res.status(200).json({
                    attachments: [
                        {
                            "title": "Login required",
                            "text": loginUrlProvider(req.body.slack_user, req.body.response_url)
                        }
                    ]
                });
                return; // skip next
            }
            next();
        });
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

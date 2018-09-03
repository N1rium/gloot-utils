const mongoose = require('mongoose');
const tokenSchema = mongoose.Schema({
  userId: { type: String, trim: true },
});
const token = mongoose.model('token', tokenSchema);

module.exports = {
  create: userId => {
    const obj = new token({ userId });
    return new Promise((res, rej) => {
      obj.save((err, resp) => {
        if (err) rej(err);
        const { userId } = resp;
        res({ userId });
      });
    });
  },

  get(userId) {
    return new Promise((res, rej) => {
      token.findOne({ userId }, { _id: 0, userId: 1 }, (err, resp) => {
        if (err) rej(err);
        res(resp);
      });
    });
  },
};

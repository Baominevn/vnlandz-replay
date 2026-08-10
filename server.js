module.exports = (req, res) => {
  if (req.method === 'POST') {
    const data = req.body || {};
    return res.status(200).json({ status: 'success', received: data });
  } else {
    return res.status(200).json({ status: 'VNLandZ Relay is online!' });
  }
};
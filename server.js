module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'POST') {
    return res.status(200).json({ status: 'success', message: 'Relay received data!' });
  } 
  
  return res.status(200).json({ status: 'VNLandZ Relay is online!' });
};
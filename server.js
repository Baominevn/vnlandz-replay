// Đoạn code ví dụ cơ bản cho Vercel Serverless Function
export default function handler(req, res) {
  if (req.method === 'POST') {
    // Nhận dữ liệu từ Discord bot hoặc gửi đi
    const data = req.body;
    return res.status(200).json({ status: 'success', received: data });
  } else if (req.method === 'GET') {
    // Trả về trạng thái để kiểm tra relay hoạt động
    return res.status(200).json({ status: 'VNLandZ Relay is online!' });
  } else {
    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
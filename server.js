import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bookingRoutes from './Routes/dateRoute.js';

dotenv.config();

const app = express();

const ATLAS_URI = process.env.ATLAS_URI;
const PORT = process.env.PORT || 5000;

mongoose.connect(ATLAS_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err.message));

app.use(cors());
app.use(express.json());

app.use('/api/bookings', bookingRoutes);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

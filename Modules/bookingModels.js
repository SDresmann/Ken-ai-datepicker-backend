import mongoose from 'mongoose';

const bookingSchema = new mongoose.Schema({
    date: {
        type: String,
        required: true,
    }
})
const Booking = mongoose.model('Booking', bookingSchema);
export default Booking;
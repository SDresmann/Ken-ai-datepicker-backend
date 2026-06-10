import express from 'express';
import Booking from '../Modules/bookingModels.js';
import { createOutlookEvent } from '../services/outlookServices.js';
const router = express.Router();

// Tue-Thu 6-7pm, Fri 2-5pm
function getClassTimes(dateISO) {
    const day = new Date(`${dateISO}T12:00:00`).getDay(); // 0=Sun ... 6=Sat
    if (day >= 2 && day <= 4) return { startTime: '18:00', endTime: '19:00' };
    if (day === 5)            return { startTime: '14:00', endTime: '17:00' };
    return null;
}

router.post('/', async (req, res) => {
    try {
        const { date } = req.body;

        const times = getClassTimes(date);
        if (!times) {
            return res.status(400).json({ message: 'No classes on that day' });
        }

        const booking = new Booking({ date });
        await booking.save();

        let outlookEventCreated = false;
        try {
            await createOutlookEvent({ dateISO: date, ...times });
            outlookEventCreated = true;
        } catch (err) {
            console.error('Outlook event failed:', err.message || err);
        }

        res.status(201).json({ booking, outlookEventCreated });
    } catch (err) {
        console.error('Booking failed:', err.message || err);
        res.status(500).json({ message: 'Booking failed' });
    }
});

export default router;

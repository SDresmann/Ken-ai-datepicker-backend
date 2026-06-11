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

async function bookClass(date) {
    const times = getClassTimes(date);
    if (!times) return { ok: false, reason: 'No classes on that day' };

    const booking = new Booking({ date });
    await booking.save();

    let outlookEventCreated = false;
    try {
        await createOutlookEvent({ dateISO: date, ...times });
        outlookEventCreated = true;
    } catch (err) {
        console.error('Outlook event failed:', err.message || err);
    }

    return { ok: true, booking, outlookEventCreated };
}

router.post('/', async (req, res) => {
    try {
        const result = await bookClass(req.body.date);
        if (!result.ok) return res.status(400).json({ message: result.reason });
        res.status(201).json(result);
    } catch (err) {
        console.error('Booking failed:', err.message || err);
        res.status(500).json({ message: 'Booking failed' });
    }
});


router.post('/hubspot-webhook', async (req, res) => {
    try {
        console.log('HubSpot webhook payload:', JSON.stringify(req.body));

        const raw =
            req.body?.properties?.class_date?.value ??
            req.body?.properties?.class_date ??
            req.body?.class_date;

        if (!raw) {
            console.error('No class_date found in webhook payload');
            return res.status(400).json({ message: 'No class_date in payload' });
        }

        // Normalize whatever HubSpot sends to YYYY-MM-DD:
        // epoch milliseconds, MM/DD/YYYY (or MM-DD-YYYY), or YYYY-MM-DD
        const s = String(raw).trim();
        const usFormat = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
        let date;
        if (/^\d+$/.test(s)) {
            date = new Date(Number(s)).toISOString().slice(0, 10);
        } else if (usFormat) {
            date = `${usFormat[3]}-${usFormat[1].padStart(2, '0')}-${usFormat[2].padStart(2, '0')}`;
        } else {
            date = s.slice(0, 10);
        }

        const result = await bookClass(date);
        if (!result.ok) {
            console.error(`Webhook booking rejected for ${date}: ${result.reason}`);
            return res.status(400).json({ message: result.reason });
        }

        res.status(201).json(result);
    } catch (err) {
        console.error('Webhook booking failed:', err.message || err);
        res.status(500).json({ message: 'Booking failed' });
    }
});

export default router;

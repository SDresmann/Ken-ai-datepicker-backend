import express from 'express';
import Booking from '../Modules/bookingModels.js';
import { createOutlookEvent } from '../services/outlookServices.js';
import { upsertHubSpotContact } from '../services/hubspotService.js';
const router = express.Router();

// Tue-Thu 6-7pm, Fri 2-5pm
function getClassTimes(dateISO) {
    const day = new Date(`${dateISO}T12:00:00`).getDay(); // 0=Sun ... 6=Sat
    if (day >= 2 && day <= 4) return { startTime: '18:00', endTime: '19:00' };
    if (day === 5)            return { startTime: '14:00', endTime: '17:00' };
    return null;
}

function normalizeDate(raw) {
    if (!raw) return null;

    // Normalize whatever the frontend/HubSpot sends to YYYY-MM-DD:
    // epoch milliseconds, MM/DD/YYYY (or MM-DD-YYYY), ISO date, or Date object
    const s = raw instanceof Date ? raw.toISOString() : String(raw).trim();
    const usFormat = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);

    if (/^\d+$/.test(s)) {
        return new Date(Number(s)).toISOString().slice(0, 10);
    }

    if (usFormat) {
        return `${usFormat[3]}-${usFormat[1].padStart(2, '0')}-${usFormat[2].padStart(2, '0')}`;
    }

    return s.slice(0, 10);
}

function toHubSpotDateValue(dateISO) {
    const [year, month, day] = dateISO.split('-').map(Number);
    return String(Date.UTC(year, month - 1, day));
}

function toHubSpotDateProperty(raw) {
    const dateISO = normalizeDate(raw);
    if (!dateISO) return '';
    return toHubSpotDateValue(dateISO);
}

function getAdditionalWorkshopDates(bookingData = {}) {
    return [
        bookingData.choose_your_2nd_date_for_career_readiness,
        bookingData.choose_your_3rd_date_for_career_readiness,
    ]
        .map(normalizeDate)
        .filter(Boolean);
}

async function bookClass(date, bookingData = {}) {
    const times = getClassTimes(date);
    if (!times) return { ok: false, reason: 'No classes on that day' };

    const classDate = bookingData.class_date || date;
    const bookingPayload = {
        ...bookingData,
        date,
        class_date: classDate,
        is_complete: true,
    };
    const booking = bookingData.email
        ? await Booking.findOneAndUpdate(
            { email: bookingData.email, class_date: classDate },
            { $set: bookingPayload },
            { new: true, upsert: true }
        )
        : await Booking.create(bookingPayload);

    let outlookEventCreated = false;
    let outlookEventsCreated = 0;
    try {
        await createOutlookEvent({ dateISO: date, ...times });
        outlookEventsCreated += 1;

        for (const additionalDate of getAdditionalWorkshopDates(bookingData)) {
            const additionalTimes = getClassTimes(additionalDate);
            if (additionalTimes) {
                await createOutlookEvent({ dateISO: additionalDate, ...additionalTimes });
                outlookEventsCreated += 1;
            }
        }

        outlookEventCreated = true;
    } catch (err) {
        console.error('Outlook event failed:', err.message || err);
    }

    return { ok: true, booking, outlookEventCreated, outlookEventsCreated };
}

router.post('/', async (req, res) => {
    try {
        const date = normalizeDate(req.body.class_date ?? req.body.date);
        const result = await bookClass(date, req.body);
        if (!result.ok) return res.status(400).json({ message: result.reason });
        res.status(201).json(result);
    } catch (err) {
        console.error('Booking failed:', err.message || err);
        res.status(500).json({ message: 'Booking failed' });
    }
});

router.post('/hubspot-step-one', async (req, res) => {
    try {
        const date = normalizeDate(req.body.class_date);

        if (!req.body.email || !date) {
            return res.status(400).json({ message: 'Email and class date are required' });
        }

        const stepOneBooking = await Booking.findOneAndUpdate(
            { email: req.body.email, class_date: date },
            {
                $set: {
                    first_name: req.body.first_name,
                    last_name: req.body.last_name,
                    email: req.body.email,
                    phone: req.body.phone,
                    marketing_message_consent: req.body.marketing_message_consent,
                    address: req.body.address,
                    city: req.body.city,
                    fullname_state: req.body.fullname_state,
                    zip: req.body.zip,
                    what_gender_do_you_identify_as_: req.body.what_gender_do_you_identify_as_,
                    what_is_your_racial_and_ethnic_identity_: req.body.what_is_your_racial_and_ethnic_identity_,
                    class_date: date,
                    choose_your_2nd_date_for_career_readiness: normalizeDate(req.body.choose_your_2nd_date_for_career_readiness) || '',
                    choose_your_3rd_date_for_career_readiness: normalizeDate(req.body.choose_your_3rd_date_for_career_readiness) || '',
                    date,
                    is_complete: false,
                },
            },
            { new: true, upsert: true }
        );

        const contact = await upsertHubSpotContact({
            firstname: req.body.first_name,
            lastname: req.body.last_name,
            email: req.body.email,
            phone: req.body.phone,
            address: req.body.address,
            city: req.body.city,
            state: req.body.fullname_state,
            zip: req.body.zip,
            gender: req.body.what_gender_do_you_identify_as_,
            what_is_your_racial_and_ethnic_identity_: req.body.what_is_your_racial_and_ethnic_identity_,
            start_date: date,
            class_date: toHubSpotDateProperty(req.body.class_date),
            choose_your_2nd_date_for_career_readiness: toHubSpotDateProperty(req.body.choose_your_2nd_date_for_career_readiness),
            choose_your_3rd_date_for_career_readiness: toHubSpotDateProperty(req.body.choose_your_3rd_date_for_career_readiness),
        });

        res.status(200).json({
            ok: true,
            booking: stepOneBooking,
            received: {
                first_name: req.body.first_name,
                last_name: req.body.last_name,
                email: req.body.email,
                phone: req.body.phone,
                marketing_message_consent: req.body.marketing_message_consent,
                class_date: date,
                choose_your_2nd_date_for_career_readiness: req.body.choose_your_2nd_date_for_career_readiness || '',
                choose_your_3rd_date_for_career_readiness: req.body.choose_your_3rd_date_for_career_readiness || '',
            },
            ...contact,
        });
    } catch (err) {
        console.error('HubSpot step one sync failed:', err.response?.data || err.message || err);
        res.status(500).json({ message: 'HubSpot sync failed' });
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

        const date = normalizeDate(raw);

        const result = await bookClass(date, { class_date: date });
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

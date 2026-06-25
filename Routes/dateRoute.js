import express from 'express';
import Booking from '../Modules/bookingModels.js';
import { createOutlookEvent } from '../services/outlookServices.js';
import { upsertHubSpotContact, inspectHubSpotSetup, buildHubSpotContactPropertiesFromBooking } from '../services/hubspotService.js';
import { HubSpotSyncError, logHubSpotFailure } from '../services/hubspotErrors.js';
const router = express.Router();

function getClassTimes(dateISO) {
    const day = new Date(`${dateISO}T12:00:00`).getDay(); // 0=Sun ... 6=Sat
    if (day >= 2 && day <= 4) return { startTime: '18:00', endTime: '19:00' };
    if (day === 5)            return { startTime: '14:00', endTime: '17:00' };
    return null;
}

function normalizeDate(raw) {
    if (!raw) return null;


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

function getPrimaryWorkshopDate(rawBody = {}) {
    return normalizeDate(
        rawBody.which_career_readiness_date_are_you_interested_in_attending_work ??
        rawBody.class_date ??
        rawBody.date
    );
}

function getAdditionalWorkshopDates(bookingData = {}) {
    return [
        bookingData.choose_the_2nd_date_for_your_career_readiness_class_work,
        bookingData.choose_the_3rd_date_for_your_career_readiness_class_work,
    ]
        .map(normalizeDate)
        .filter(Boolean);
}

async function bookClass(date, bookingData = {}) {
    const times = getClassTimes(date);
    if (!times) return { ok: false, reason: 'No classes on that day' };

    const classDate = bookingData.which_career_readiness_date_are_you_interested_in_attending_work || date;
    const bookingPayload = {
        ...bookingData,
        date,
        which_career_readiness_date_are_you_interested_in_attending_work: classDate,
        career_readiness_form_status: bookingData.career_readiness_form_status || 'Complete',
        is_complete: true,
    };
    const booking = bookingData.email
        ? await Booking.findOneAndUpdate(
            { email: bookingData.email, which_career_readiness_date_are_you_interested_in_attending_work: classDate },
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

    let hubspot = null;
    let hubspotError = null;

    if (bookingData.email) {
        try {
            hubspot = await upsertHubSpotContact(buildHubSpotContactPropertiesFromBooking(bookingPayload));
        } catch (err) {
            hubspotError = err instanceof HubSpotSyncError
                ? err.message
                : err.message || 'HubSpot sync failed';
            console.error('HubSpot full form sync failed:', hubspotError);
        }
    }

    return { ok: true, booking, outlookEventCreated, outlookEventsCreated, hubspot, hubspotError };
}

router.post('/', async (req, res) => {
    try {
        const date = getPrimaryWorkshopDate(req.body);
        const result = await bookClass(date, req.body);
        if (!result.ok) return res.status(400).json({ message: result.reason });
        res.status(201).json(result);
    } catch (err) {
        console.error('Booking failed:', err.message || err);
        res.status(500).json({ message: 'Booking failed' });
    }
});

function buildBookingUpdate(body, date) {
    return {
        first_name: body.first_name,
        last_name: body.last_name,
        email: body.email,
        phone: body.phone,
        marketing_message_consent: body.marketing_message_consent,
        address: body.address,
        city: body.city,
        fullname_state: body.fullname_state,
        zip: body.zip,
        are_you_under_18_years_old: body.are_you_under_18_years_old,
        date_of_birth: normalizeDate(body.date_of_birth) || '',
        what_gender_do_you_identify_as_: body.what_gender_do_you_identify_as_,
        what_is_your_racial_and_ethnic_identity_: body.what_is_your_racial_and_ethnic_identity_,
        which_career_readiness_date_are_you_interested_in_attending_work: date,
        choose_the_2nd_date_for_your_career_readiness_class_work: normalizeDate(body.choose_the_2nd_date_for_your_career_readiness_class_work) || '',
        choose_the_3rd_date_for_your_career_readiness_class_work: normalizeDate(body.choose_the_3rd_date_for_your_career_readiness_class_work) || '',
        are_you_still_finishing_high_school: body.are_you_still_finishing_high_school,
        whats_the_full_name_of_your_school: body.whats_the_full_name_of_your_school,
        what_grade_are_you_currently_in: body.what_grade_are_you_currently_in,
        highest_level_of_education_: body.highest_level_of_education_,
        i_or_a_family_member_i_live_with_receive_the_following_type_of_public_assistancecheck_all_that_apply:
            body.i_or_a_family_member_i_live_with_receive_the_following_type_of_public_assistancecheck_all_that_apply,
        please_check_all_of_these_situations_that_apply_to_you: body.please_check_all_of_these_situations_that_apply_to_you,
        are_you_a_parent: body.are_you_a_parent,
        how_many_children_do_you_have: body.how_many_children_do_you_have,
        are_you_a_single_parent: body.are_you_a_single_parent,
        are_you_involved_in_the_justice_system: body.are_you_involved_in_the_justice_system,
        what_is_your_status_in_the_justice_system_check_all_that_apply: body.what_is_your_status_in_the_justice_system_check_all_that_apply,
        what_is_your_offense_status_check_all_that_apply: body.what_is_your_offense_status_check_all_that_apply,
        what_is_your_system_level_check_all_that_apply: body.what_is_your_system_level_check_all_that_apply,
        do_you_grant_permission_for_your_data_as_it_relates_to_this_program_to_be_collected_and_tracked:
            body.do_you_grant_permission_for_your_data_as_it_relates_to_this_program_to_be_collected_and_tracked,
        i_consent_to_the_irrevocable_right_to_use_my_name__or_a_fictional_name___statement_s__story__photog:
            body.i_consent_to_the_irrevocable_right_to_use_my_name__or_a_fictional_name___statement_s__story__photog,
        digital_signature: body.digital_signature,
        date_signed: normalizeDate(body.date_signed) || '',
        whats_your_employment_status_pick_only_1: body.whats_your_employment_status_pick_only_1,
        career_readiness_form_status: body.career_readiness_form_status || 'Partial',
        date,
        is_complete: false,
    };
}

router.post('/hubspot-step-one', async (req, res) => {
    const date = getPrimaryWorkshopDate(req.body);

    if (!req.body.email || !date) {
        return res.status(400).json({
            message: 'Email and workshop date are required',
            detail: !req.body.email
                ? 'Email is missing from the request.'
                : 'Workshop date is missing or invalid. Expected which_career_readiness_date_are_you_interested_in_attending_work.',
            received: {
                email: req.body.email || '',
                which_career_readiness_date_are_you_interested_in_attending_work:
                    req.body.which_career_readiness_date_are_you_interested_in_attending_work || '',
                class_date: req.body.class_date || '',
            },
        });
    }

    const hubspotInput = buildHubSpotContactPropertiesFromBooking({
        ...req.body,
        which_career_readiness_date_are_you_interested_in_attending_work: date,
        class_date: date,
        career_readiness_form_status: req.body.career_readiness_form_status || 'Partial',
    });

    let stepOneBooking;

    try {
        stepOneBooking = await Booking.findOneAndUpdate(
            { email: req.body.email, which_career_readiness_date_are_you_interested_in_attending_work: date },
            { $set: buildBookingUpdate(req.body, date) },
            { new: true, upsert: true }
        );
    } catch (err) {
        const errorBody = {
            step: 'mongodb',
            message: 'MongoDB save failed before HubSpot sync',
            detail: err.message,
        };
        console.error('HubSpot step one MongoDB failed:', errorBody);
        return res.status(500).json(errorBody);
    }

    try {
        const contact = await upsertHubSpotContact(hubspotInput);

        res.status(200).json({
            ok: true,
            booking: stepOneBooking,
            received: {
                first_name: req.body.first_name,
                last_name: req.body.last_name,
                email: req.body.email,
                phone: req.body.phone,
                marketing_message_consent: req.body.marketing_message_consent,
                which_career_readiness_date_are_you_interested_in_attending_work: date,
                choose_the_2nd_date_for_your_career_readiness_class_work: req.body.choose_the_2nd_date_for_your_career_readiness_class_work || '',
                choose_the_3rd_date_for_your_career_readiness_class_work: req.body.choose_the_3rd_date_for_your_career_readiness_class_work || '',
            },
            ...contact,
        });
    } catch (err) {
        if (err instanceof HubSpotSyncError) {
            const errorBody = logHubSpotFailure('HubSpot step one sync failed', err, {
                step: err.step,
                attemptedPayload: err.attemptedPayload,
                skippedProperties: err.skippedProperties,
            });
            return res.status(500).json(errorBody);
        }

        const errorBody = logHubSpotFailure('HubSpot step one sync failed', err, {
            step: 'hubspot_sync',
            attemptedPayload: hubspotInput,
        });
        return res.status(500).json(errorBody);
    }
});

router.get('/hubspot-debug', async (req, res) => {
    try {
        const report = await inspectHubSpotSetup();
        res.status(report.ok ? 200 : 500).json(report);
    } catch (err) {
        res.status(500).json({
            ok: false,
            step: 'hubspot_debug',
            detail: err.message,
        });
    }
});


router.post('/hubspot-webhook', async (req, res) => {
    try {
        console.log('HubSpot webhook payload:', JSON.stringify(req.body));

        const raw =
            req.body?.properties?.which_career_readiness_date_are_you_interested_in_attending_work?.value ??
            req.body?.properties?.which_career_readiness_date_are_you_interested_in_attending_work ??
            req.body?.which_career_readiness_date_are_you_interested_in_attending_work ??
            req.body?.properties?.class_date?.value ??
            req.body?.properties?.class_date ??
            req.body?.class_date;

        if (!raw) {
            console.error('No which_career_readiness_date_are_you_interested_in_attending_work found in webhook payload');
            return res.status(400).json({ message: 'No which_career_readiness_date_are_you_interested_in_attending_work in payload' });
        }

        const date = normalizeDate(raw);

        const result = await bookClass(date, { which_career_readiness_date_are_you_interested_in_attending_work: date });
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

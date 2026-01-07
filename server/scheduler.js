const cron = require('node-cron');

module.exports = function({ db, webpush }){
  // schedule: run every 10 seconds for faster notification delivery
  cron.schedule('*/10 * * * * *', async () => {
    const now = Date.now();
    // in-memory failure tracker: subscriptionId -> consecutive failures
    const failureCounts = {};
    try{
      db.getDueReminders(now, async (err, reminders) => {
        if(err) return console.warn('Scheduler DB error', err);
        for(const r of reminders){
          try{
            // Account-wide behavior: if a reminder has userId, broadcast to ALL subscriptions for that userId.
            if (r.userId) {
              db.getSubscriptionsByUserId(r.userId, async (err2, subs) => {
                if(err2) {
                  console.warn('subs fetch err', err2);
                  return db.markDelivered(r.id);
                }
                for(const s of subs){
                  try{
                    await webpush.sendNotification(s.subscription, JSON.stringify({ title: r.title || 'Reminder', body: r.body || '', data: { reminderId: r.id } }));
                    if(failureCounts[s.id]) failureCounts[s.id] = 0;
                  }catch(e){
                    console.warn('push send fail', e && e.statusCode ? ('status:' + e.statusCode) : e);
                    const status = e && e.statusCode ? e.statusCode : (e && e.status ? e.status : null);
                    const endpoint = (s.subscription && s.subscription.endpoint) ? s.subscription.endpoint : null;
                    if(status === 410 || status === 404){
                      console.log('Removing subscription (permanent) id=', s.id, 'endpoint=', endpoint);
                      db.removeSubscriptionById(s.id, ()=>{});
                    } else {
                      failureCounts[s.id] = (failureCounts[s.id] || 0) + 1;
                      if(failureCounts[s.id] >= 2){
                        console.log('Removing subscription after repeated failures id=', s.id);
                        db.removeSubscriptionById(s.id, ()=>{});
                      }
                    }
                  }
                }
                db.markDelivered(r.id);
              });
            } else if (r.subscriptionId) {
              // Legacy/device-specific reminder: send only to that subscription
              db.getSubscriptionById(r.subscriptionId, async (err2, sub) => {
                if(err2) {
                  console.warn('Failed to get subscription:', err2);
                  return db.markDelivered(r.id);
                }
                if(!sub) {
                  console.warn('Subscription not found for reminder:', r.id, 'subscriptionId:', r.subscriptionId);
                  return db.markDelivered(r.id);
                }

                try{
                  await webpush.sendNotification(sub.subscription, JSON.stringify({ title: r.title || 'Reminder', body: r.body || '', data: { reminderId: r.id } }));
                  console.log('[Scheduler] Sent reminder to subscriptionId:', r.subscriptionId);
                  if(failureCounts[sub.id]) failureCounts[sub.id] = 0;
                }catch(e){
                  console.warn('push send fail', e && e.statusCode ? ('status:' + e.statusCode) : e);
                  const status = e && e.statusCode ? e.statusCode : (e && e.status ? e.status : null);
                  const endpoint = (sub.subscription && sub.subscription.endpoint) ? sub.subscription.endpoint : null;
                  if(status === 410 || status === 404){
                    console.log('Removing subscription (permanent) id=', sub.id, 'endpoint=', endpoint);
                    db.removeSubscriptionById(sub.id, ()=>{});
                  } else {
                    failureCounts[sub.id] = (failureCounts[sub.id] || 0) + 1;
                    if(failureCounts[sub.id] >= 2){
                      console.log('Removing subscription after repeated failures id=', sub.id);
                      db.removeSubscriptionById(sub.id, ()=>{});
                    }
                  }
                }
                db.markDelivered(r.id);
              });
            } else {
              // No subscriptionId and no userId: can't send
              console.warn('[Scheduler] Reminder', r.id, 'has neither subscriptionId nor userId - marking as delivered without sending');
              db.markDelivered(r.id);
            }
          }catch(e){ console.warn('scheduler send error', e); }
        }
      });
    }catch(e){ console.warn('scheduler top error', e); }
  });

  console.log('Scheduler started (checking every 10 seconds)');
};

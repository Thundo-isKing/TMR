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
            // find subscriptions for userId or send to all if userId null
            if(r.userId){
              db.getSubscriptionsByUserId(r.userId, async (err2, subs) => {
                if(err2) return console.warn('subs fetch err', err2);
                for(const s of subs){
                  try{
                    await webpush.sendNotification(s.subscription, JSON.stringify({ title: r.title || 'Reminder', body: r.body || '', data: { reminderId: r.id } }));
                    // reset failure count on success
                    if(s && s.id && failureCounts[s.id]) failureCounts[s.id] = 0;
                  }catch(e){
                    console.warn('push send fail', e && e.statusCode ? ('status:' + e.statusCode) : e);
                    // if permanent (410 Gone) or Not Found, remove subscription immediately
                    const status = e && e.statusCode ? e.statusCode : (e && e.status ? e.status : null);
                    const endpoint = (s && s.subscription && s.subscription.endpoint) ? s.subscription.endpoint : (s && s.subscription ? s.subscription : null);
                    const sid = s && s.id;
                    if(status === 410 || status === 404){
                      console.log('Removing subscription (permanent) id=', sid, 'endpoint=', endpoint);
                      if(sid) db.removeSubscriptionById(sid, ()=>{});
                      else if(endpoint) db.removeSubscriptionByEndpoint(endpoint, ()=>{});
                    } else {
                      // transient: increment failure count and remove after 2 consecutive failures
                      if(sid){ failureCounts[sid] = (failureCounts[sid] || 0) + 1; if(failureCounts[sid] >= 2){ console.log('Removing subscription after repeated failures id=', sid); db.removeSubscriptionById(sid, ()=>{}); } }
                    }
                  }
                }
                db.markDelivered(r.id);
              });
            } else {
              // broadcast to all subscriptions
              db.getAllSubscriptions(async (err2, subs) => {
                if(err2) return console.warn('subs fetch err', err2);
                for(const s of subs){
                  try{
                    await webpush.sendNotification(s.subscription, JSON.stringify({ title: r.title || 'Reminder', body: r.body || '', data: { reminderId: r.id } }));
                    if(s && s.id && failureCounts[s.id]) failureCounts[s.id] = 0;
                  }catch(e){
                    console.warn('push send fail', e && e.statusCode ? ('status:' + e.statusCode) : e);
                    const status = e && e.statusCode ? e.statusCode : (e && e.status ? e.status : null);
                    const endpoint = (s && s.subscription && s.subscription.endpoint) ? s.subscription.endpoint : (s && s.subscription ? s.subscription : null);
                    const sid = s && s.id;
                    if(status === 410 || status === 404){
                      console.log('Removing subscription (permanent) id=', sid, 'endpoint=', endpoint);
                      if(sid) db.removeSubscriptionById(sid, ()=>{});
                      else if(endpoint) db.removeSubscriptionByEndpoint(endpoint, ()=>{});
                    } else {
                      if(sid){ failureCounts[sid] = (failureCounts[sid] || 0) + 1; if(failureCounts[sid] >= 2){ console.log('Removing subscription after repeated failures id=', sid); db.removeSubscriptionById(sid, ()=>{}); } }
                    }
                  }
                }
                db.markDelivered(r.id);
              });
            }
          }catch(e){ console.warn('scheduler send error', e); }
        }
      });
    }catch(e){ console.warn('scheduler top error', e); }
  });

  console.log('Scheduler started (checking every minute)');
};

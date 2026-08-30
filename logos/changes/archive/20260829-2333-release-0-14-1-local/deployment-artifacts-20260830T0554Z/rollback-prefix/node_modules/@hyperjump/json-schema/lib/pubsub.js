const subscriptions = {};
let uid = 0;

export const subscribe = (message, fn) => {
  if (!(message in subscriptions)) {
    subscriptions[message] = {};
  }

  const subscriptionId = `pubsub_subscription_${uid++}`;
  subscriptions[message][subscriptionId] = fn;

  return subscriptionId;
};

export const unsubscribe = (message, token) => {
  delete subscriptions[message][token];
};

export const publishAsync = async (message, data) => {
  const promises = [];
  if (message in subscriptions) {
    for (const subscriptionId in subscriptions[message]) {
      promises.push(subscriptions[message][subscriptionId](message, data));
    }
  }
  await Promise.all(promises);
};

// Initialize scheduled notifications array
window.scheduledNotifications = []; // Make it globally accessible

// Add message channel helper for service worker communication
window.messageChannelTimeout = 5000; // 5 second timeout for message responses

// Helper function for service worker messaging with timeout
window.sendMessageToSW = function(message) {
  return new Promise((resolve, reject) => {
    if (!navigator.serviceWorker || !navigator.serviceWorker.controller) {
      return reject(new Error('No active service worker'));
    }
    
    const messageChannel = new MessageChannel();
    let timeoutId;
    
    // Set up response handler
    messageChannel.port1.onmessage = (event) => {
      clearTimeout(timeoutId);
      resolve(event.data);
    };
    
    // Set timeout to prevent hanging promises
    timeoutId = setTimeout(() => {
      messageChannel.port1.close();
      reject(new Error('Service worker response timeout'));
    }, window.messageChannelTimeout);
    
    // Send the message
    navigator.serviceWorker.controller.postMessage(message, [messageChannel.port2]);
  });
};

// Add sendNotification function
window.sendNotification = function(title = 'PWA Notification', body = 'This is a notification from your PWA') {
  const statusElement = document.getElementById('status');
  const options = {
    body: body,
    icon: '/static/icons/icon-192x192.png',
    badge: '/static/icons/icon-192x192.png',
    vibrate: [100, 50, 100],
    tag: 'notification-' + Date.now(),
    renotify: true,
    requireInteraction: true,
    data: {
      dateOfArrival: Date.now(),
      primaryKey: Date.now()
    }
  };

  // Check if service worker is active
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready.then(function(registration) {
      registration.showNotification(title, options)
        .then(() => {
          if (statusElement) {
            statusElement.textContent = 'Notification sent successfully!';
          }
          console.log('Notification sent successfully!');
        })
        .catch(error => {
          console.error('Error showing notification:', error);
          if (statusElement) {
            statusElement.textContent = 'Error sending notification: ' + error.message;
          }
        });
    });
  } else {
    // Fallback to regular notification
    try {
      new Notification(title, options);
      if (statusElement) {
        statusElement.textContent = 'Notification sent successfully!';
      }
      console.log('Notification sent via regular API successfully!');
    } catch (error) {
      console.error('Error showing notification:', error);
      if (statusElement) {
        statusElement.textContent = 'Error sending notification: ' + error.message;
      }
    }
  }
};

// Function to save scheduled notifications to localStorage
function saveScheduledNotifications() {
  try {
    // Create a clean copy without timeout IDs (which can't be serialized)
    const cleanNotifications = window.scheduledNotifications.map(notification => {
      // Create a new object without the timeout ID
      const { _timeoutId, ...cleanNotification } = notification;
      return cleanNotification;
    });
    
    localStorage.setItem('scheduledNotifications', JSON.stringify(cleanNotifications));
    console.log(`Saved ${cleanNotifications.length} notifications to localStorage`);
    
    // Update UI
    updateScheduledNotificationsUI();
  } catch (error) {
    console.error('Error saving notifications:', error);
  }
}

// Update UI with scheduled notifications
// Improve the updateScheduledNotificationsUI function
function updateScheduledNotificationsUI() {
  console.log('Updating scheduled notifications UI');
  
  const container = document.getElementById('scheduledNotifications');
  if (!container) {
    console.error('Scheduled notifications container not found');
    return;
  }
  
  // Clear the container
  container.innerHTML = '';
  
  // Check if we have notifications
  if (!window.scheduledNotifications || window.scheduledNotifications.length === 0) {
    container.innerHTML = '<p>No scheduled notifications</p>';
    return;
  }
  
  console.log(`Displaying ${window.scheduledNotifications.length} notifications`);
  
  // Sort by time
  const sortedNotifications = [...window.scheduledNotifications].sort((a, b) => a.time - b.time);
  
  // Create notification items
  sortedNotifications.forEach((notification, index) => {
    const notificationTime = new Date(notification.time);
    const item = document.createElement('div');
    item.style.border = '1px solid #ccc';
    item.style.padding = '10px';
    item.style.marginBottom = '10px';
    
    let repeatText = '';
    switch(notification.repeat) {
      case 'daily': repeatText = ' (Repeats Daily)'; break;
      case 'weekly': repeatText = ' (Repeats Weekly)'; break;
      default: repeatText = ' (One-time)';
    }
    
    item.innerHTML = `
      <div>
        <strong>${notification.title}</strong><br>
        ${notification.body}<br>
        <small>${notificationTime.toLocaleString()}${repeatText}</small>
      </div>
      <button data-index="${index}" style="margin-top: 5px;">Delete</button>
    `;
    
    container.appendChild(item);
  });
  
  // Add event listeners to delete buttons
  document.querySelectorAll('[data-index]').forEach(button => {
    button.addEventListener('click', function() {
      const index = parseInt(this.getAttribute('data-index'));
      removeScheduledNotification(index);
    });
  });
}

// Helper function to get CSRF token from cookies
function getCookie(name) {
  let cookieValue = null;
  if (document.cookie && document.cookie !== '') {
    const cookies = document.cookie.split(';');
    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i].trim();
      if (cookie.substring(0, name.length + 1) === (name + '=')) {
        cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
        break;
      }
    }
  }
  return cookieValue;
}

// Helper function to convert base64 to Uint8Array (VAPID key format)
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Update setupPushSubscription function to send an immediate test notification
function setupPushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    document.getElementById('status').textContent = 'Push notifications not supported in this browser';
    return Promise.reject(new Error('Push notifications not supported'));
  }
  
  // iOS detection
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  console.log('Setting up push subscription, iOS device:', isIOS);
  
  // First, register or get the service worker
  let swRegistration;
  return navigator.serviceWorker.ready
    .then(registration => {
      swRegistration = registration;
      console.log('Service Worker is ready:', registration);
      
      // Check existing subscription
      return registration.pushManager.getSubscription();
    })
    .then(subscription => {
      if (subscription) {
        // We already have a subscription
        console.log('Existing push subscription found');
        
        // Update the UI
        const subData = subscription.toJSON();
        if (subData.keys && subData.keys.p256dh) {
          subData.keys.p256dh = subData.keys.p256dh.substring(0, 10) + '...';
        }
        if (subData.keys && subData.keys.auth) {
          subData.keys.auth = subData.keys.auth.substring(0, 5) + '...';
        }
        document.getElementById('pushSubscription').textContent = JSON.stringify(subData, null, 2);
        
        return subscription;
      }
      
      // Your VAPID public key from settings.py
      const vapidPublicKey = 'BM29P5O99J9F-DUOyqNwGyurNl5a3ZSkBa0ZlOLR9AylchmgPwHbCeZaFGlEcKoAUOaZvNk5aXa0dHSDS_RT2v0';
      const convertedVapidKey = urlBase64ToUint8Array(vapidPublicKey);
      
      // iOS requires specific options
      const subscribeOptions = {
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey
      };
      
      console.log('Creating new push subscription with options:', subscribeOptions);
      
      // Create a new subscription
      return swRegistration.pushManager.subscribe(subscribeOptions);
    })
    .then(subscription => {
      console.log('New subscription created:', subscription);
      
      // Save the subscription to the server
      return fetch('/api/save-subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCookie('csrftoken')
        },
        body: JSON.stringify(subscription.toJSON())
      })
      .then(response => {
        if (!response.ok) {
          throw new Error('Failed to save subscription to server');
        }
        return response.json();
      })
      .then(responseData => {
        console.log('Subscription saved to server:', responseData);
        
        // Update the UI
        const subData = subscription.toJSON();
        if (subData.keys && subData.keys.p256dh) {
          subData.keys.p256dh = subData.keys.p256dh.substring(0, 10) + '...';
        }
        if (subData.keys && subData.keys.auth) {
          subData.keys.auth = subData.keys.auth.substring(0, 5) + '...';
        }
        document.getElementById('pushSubscription').textContent = JSON.stringify(subData, null, 2);
        
        return subscription;
      });
    })
    .catch(error => {
      console.error('Error setting up push subscription:', error);
      document.getElementById('pushSubscription').textContent = 'Error: ' + error.message;
      throw error;
    });
}

// Function to initialize scheduled notifications - THIS IS WHAT THE SERVICE WORKER IS LOOKING FOR
window.initScheduledNotifications = function(registration) {
  console.log('Initializing scheduled notifications');
  // Load from localStorage first
  const savedNotifications = localStorage.getItem('scheduledNotifications');
  if (savedNotifications) {
    try {
      window.scheduledNotifications = JSON.parse(savedNotifications);
      console.log(`Loaded ${window.scheduledNotifications.length} notifications from localStorage`);
    } catch (error) {
      console.error('Error parsing stored notifications:', error);
      window.scheduledNotifications = [];
    }
  }

  // Check for expired one-time notifications
  const now = Date.now();
  window.scheduledNotifications = window.scheduledNotifications.filter(notification => {
    // Keep all repeating notifications
    if (notification.repeat && notification.repeat !== 'none') {
      return true;
    }
    // For one-time notifications, only keep future ones
    return notification.time > now;
  });

  // Update UI immediately
  updateScheduledNotificationsUI();

  // Schedule all notifications
  for (const notification of window.scheduledNotifications) {
    scheduleNotification(notification, false); // Don't re-save to avoid loop
  }

  // Send to service worker
  syncWithServiceWorker();
};

// Schedule a notification
function scheduleNotification(notification, shouldSave = true) {
  // Log scheduling
  console.log(`Scheduling notification "${notification.title}" for ${new Date(notification.time).toLocaleString()}`);
  
  // For immediate UI feedback
  if (shouldSave) {
    // Add to array if new
    if (!window.scheduledNotifications.find(n => n.id === notification.id)) {
      window.scheduledNotifications.push(notification);
    }
    // Save to localStorage
    saveScheduledNotifications();
  }
  
  // Calculate delay
  const now = Date.now();
  const delay = notification.time - now;
  
  // Skip past notifications
  if (delay <= 0) return;
  
  // Set timeout for browser context
  const timeoutId = setTimeout(() => {
    console.log(`Time to show notification: ${notification.title}`);
    
    // Show the notification
    sendNotification(notification.title, notification.body);
    
    // Handle repeating logic
    if (notification.repeat === 'daily') {
      // Schedule next day
      const nextTime = notification.time + (24 * 60 * 60 * 1000);
      const updatedNotification = { ...notification, time: nextTime };
      
      // Update in array
      const index = window.scheduledNotifications.findIndex(n => n.id === notification.id);
      if (index !== -1) {
        window.scheduledNotifications[index] = updatedNotification;
        saveScheduledNotifications();
        scheduleNotification(updatedNotification, false);
      }
    } else if (notification.repeat === 'weekly') {
      // Schedule next week
      const nextTime = notification.time + (7 * 24 * 60 * 60 * 1000);
      const updatedNotification = { ...notification, time: nextTime };
      
      // Update in array
      const index = window.scheduledNotifications.findIndex(n => n.id === notification.id);
      if (index !== -1) {
        window.scheduledNotifications[index] = updatedNotification;
        saveScheduledNotifications();
        scheduleNotification(updatedNotification, false);
      }
    } else {
      // One-time notification - remove it
      const index = window.scheduledNotifications.findIndex(n => n.id === notification.id);
      if (index !== -1) {
        window.scheduledNotifications.splice(index, 1);
        saveScheduledNotifications();
      }
    }
  }, delay);
  
  // Store timeout ID for cleanup
  const index = window.scheduledNotifications.findIndex(n => n.id === notification.id);
  if (index !== -1) {
    // Store as a property
    window.scheduledNotifications[index]._timeoutId = timeoutId;
  }
  
  // Sync with service worker
  syncWithServiceWorker();
}

// Remove a scheduled notification
function removeScheduledNotification(index) {
  if (index < 0 || index >= window.scheduledNotifications.length) return;
  
  const notification = window.scheduledNotifications[index];
  
  // Clear the timeout if it exists
  if (notification._timeoutId) {
    clearTimeout(notification._timeoutId);
  }
  
  // Remove from array and save
  window.scheduledNotifications.splice(index, 1);
  saveScheduledNotifications();
  
  // Update service worker
  syncWithServiceWorker();
}

// Sync with service worker - UPDATED to use the message channel
function syncWithServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  
  navigator.serviceWorker.ready.then(registration => {
    if (registration.active) {
      console.log('Syncing notifications with service worker');
      
      // Create a clean copy for the service worker
      const cleanNotifications = window.scheduledNotifications.map(notification => {
        const { _timeoutId, ...cleanNotification } = notification;
        return cleanNotification;
      });
      
      // Use the new message channel approach instead of direct postMessage
      window.sendMessageToSW({
        type: 'SETUP_NOTIFICATIONS',
        notifications: cleanNotifications
      }).then(response => {
        console.log('Service worker acknowledged notification sync:', response);
      }).catch(err => {
        console.warn('Service worker message failed, falling back to direct postMessage:', err);
        // Fallback to direct postMessage if the channel approach fails
        registration.active.postMessage({
          type: 'SETUP_NOTIFICATIONS',
          notifications: cleanNotifications
        });
      });
    }
  }).catch(err => {
    console.error('Error syncing with service worker:', err);
  });
}

// Update permission status UI
function updatePermissionStatus() {
  const permStatus = document.getElementById('permissionStatus');
  
  if (!('Notification' in window)) {
    permStatus.textContent = 'Notifications are not supported in this browser';
    return;
  }
  
  switch(Notification.permission) {
    case 'granted':
      permStatus.textContent = 'Notification permission granted! Background notifications are enabled.';
      break;
    case 'denied':
      permStatus.textContent = 'Notification permission denied. Please enable notifications in your browser settings.';
      break;
    default:
      permStatus.textContent = 'Please enable notifications for background functionality.';
  }
}

// Update the requestNotificationPermission function with iOS-specific CSS
function requestNotificationPermission() {
  // Check if browser supports notifications
  if (!('Notification' in window)) {
    console.error('This browser does not support notifications');
    alert('This browser does not support notifications');
    return Promise.reject(new Error('Notifications not supported'));
  }
  
  console.log('Requesting notification permission...');
  
  // Add iOS standalone mode detection
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  if (isIOS) {
    // Add iOS safe area insets if not already added
    if (!document.getElementById('ios-standalone-style')) {
      const style = document.createElement('style');
      style.id = 'ios-standalone-style';
      style.textContent = `
        @media (display-mode: standalone) {
          body {
            padding-top: env(safe-area-inset-top);
            padding-bottom: env(safe-area-inset-bottom);
            padding-left: env(safe-area-inset-left);
            padding-right: env(safe-area-inset-right);
          }
        }
      `;
      document.head.appendChild(style);
    }
  }
  
  // Request permission and handle iOS specifics
  return Notification.requestPermission()
    .then(permission => {
      if (permission === 'granted') {
        console.log('Notification permission granted');
        
        // iOS detection
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        
        // Update UI immediately to show success
        const statusElement = document.getElementById('status');
        statusElement.textContent = 'Notification permission granted! Setting up push subscription...';
        
        // Update the permission status display
        updatePermissionStatus();
        
        // Set up push subscription (important for iOS)
        return setupPushSubscription().then(result => {
          if (isIOS) {
            // Add iOS-specific guidance
            const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
            if (!isStandalone) {
              statusElement.textContent += ' For best results on iOS, add this app to your home screen.';
            }
          }
          return result;
        });
      } else {
        console.log('Notification permission denied');
        
        const statusElement = document.getElementById('status');
        statusElement.textContent = 'Notification permission denied. Please enable notifications in browser settings.';
        
        // Also update the permission status display
        updatePermissionStatus();
        
        return { success: false, error: 'Permission denied' };
      }
    });
}

// Add Schedule button event listener
// Update the scheduleNotification button handler
document.getElementById('scheduleBtn').addEventListener('click', function() {
  const title = document.getElementById('notificationTitle').value || 'Scheduled PWA Notification';
  const body = document.getElementById('notificationMessage').value || 'This is your scheduled notification';
  const timeString = document.getElementById('notificationTime').value;
  const repeat = document.getElementById('notificationRepeat').value;
  const statusElement = document.getElementById('status');
  
  if (!timeString) {
    statusElement.textContent = 'Please select a valid time';
    return;
  }
  
  const time = new Date(timeString).getTime();
  
  if (time <= Date.now()) {
    statusElement.textContent = 'Please select a future time';
    return;
  }
  
  // Add notification to schedule
  const notification = {
    id: Date.now().toString(),  // Unique ID
    title: title,
    body: body,
    time: time,
    repeat: repeat
  };
  
  // Add to the scheduledNotifications array
  if (!window.scheduledNotifications) {
    window.scheduledNotifications = [];
  }
  
  window.scheduledNotifications.push(notification);
  
  // Save and schedule
  saveScheduledNotifications();
  scheduleNotification(notification);
  
  statusElement.textContent = 'Notification scheduled! Check the list below.';
  
  // Force an immediate UI update
  updateScheduledNotificationsUI();
  
  // Reset form
  document.getElementById('notificationTitle').value = 'Scheduled PWA Notification';
  document.getElementById('notificationMessage').value = 'This is your scheduled notification';
  const newDefault = new Date(Date.now() + 60000);
  document.getElementById('notificationTime').value = newDefault.toISOString().slice(0, 16);
});

// Add notification button event listener
document.getElementById('notifyBtn').addEventListener('click', function() {
  requestNotificationPermission()
    .then(result => {
      console.log('Permission request result:', result);
      // Force another UI update regardless of the result
      updatePermissionStatus();
    })
    .catch(error => {
      console.error('Error requesting permission:', error);
    });
});


// Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    console.log('Attempting to register service worker...');
    navigator.serviceWorker.register('/service-worker.js', {
      scope: '/'  // Use root scope
    })
    .then(function(registration) {
      console.log('Service Worker registered successfully with scope: ', registration.scope);
      // After successful registration, check for push subscription
      checkPushSubscription();
      
      // For iOS, we need to ensure the service worker is fully activated
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      if (isIOS && registration.active) {
        console.log('Sending ping to ensure service worker is fully activated');
        return window.sendMessageToSW({ type: 'PING' })
          .then(() => {
            console.log('Service worker responded to ping');
            return registration;
          })
          .catch(() => {
            console.log('Ping failed, but continuing with subscription process');
            return registration;
          });
      }
      return registration;
    })
    .catch(function(err) {
      console.error('Service Worker registration failed: ', err);
    });
  });
}

// Function to check push subscription status
function checkPushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    document.getElementById('pushSubscription').textContent = 'Push notifications not supported in this browser';
    return;
  }
  
  navigator.serviceWorker.ready
    .then(function(registration) {
      console.log('Checking for existing push subscription...');
      return registration.pushManager.getSubscription();
    })
    .then(function(subscription) {
      if (subscription) {
        console.log('Existing push subscription found');
        // Show subscription details but truncate the keys for security
        const subData = subscription.toJSON();
        if (subData.keys && subData.keys.p256dh) {
          subData.keys.p256dh = subData.keys.p256dh.substring(0, 10) + '...';
        }
        if (subData.keys && subData.keys.auth) {
          subData.keys.auth = subData.keys.auth.substring(0, 5) + '...';
        }
        document.getElementById('pushSubscription').textContent = JSON.stringify(subData, null, 2);
      } else {
        console.log('No push subscription found');
        document.getElementById('pushSubscription').textContent = 'No active subscription';
      }
    })
    .catch(function(error) {
      console.error('Error checking push subscription:', error);
      document.getElementById('pushSubscription').textContent = 'Error: ' + error.message;
    });
}

// Add this code to initialize notifications after service worker registration
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.ready.then(registration => {
    // Make sure window.initScheduledNotifications is defined
    if (typeof window.initScheduledNotifications === 'function') {
      window.initScheduledNotifications(registration);
    } else {
      console.error('initScheduledNotifications function is not defined');
    }
  }).catch(error => {
    console.error('Error initializing notifications:', error);
  });
}
    
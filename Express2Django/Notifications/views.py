import os
from django.shortcuts import render
from django.http import HttpResponse, JsonResponse
from django.views.decorators.http import require_POST
from datetime import datetime, timedelta, timezone
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings
from .models import Notification, PushSubscription
import json
import pywebpush
import time  # Add this import for the timestamp in test notification

# Import Celery task functionality
from celery import shared_task

def index(request):
    # Add debug information to the context
    debug_info = {
        'user_agent': request.META.get('HTTP_USER_AGENT', 'Unknown'),
        'is_https': request.is_secure(),
        'host': request.get_host(),
    }
    
    return render(request, 'index.html', {'debug_info': debug_info})

@csrf_exempt
def get_scheduled_notifications(request):

    # In the schedule_notification view
    try:
        data = json.loads(request.body)
        
        # Parse timestamp and make timezone aware
        scheduled_time = datetime.fromtimestamp(int(data.get('scheduledTime')) / 1000)
        scheduled_time = timezone.make_aware(scheduled_time)  # Add this line
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=400)
    
    # Create the notification with the timezone-aware datetime
    notification = Notification.objects.create(
        user=request.user if request.user.is_authenticated else None,
        title=data.get('title'),
        body=data.get('body'),
        scheduled_time=scheduled_time,  # Use the timezone-aware datetime
        repeat=data.get('repeat', 'none')
    )
    
    # Rest of your function...
    # For anonymous users or testing, this can work without login
    if request.user.is_authenticated:
        notifications = list(Notification.objects.filter(
            user=request.user,
            sent=False
        ).values())
    else:
        notifications = list(Notification.objects.filter(
            user=None,
            sent=False
        ).values())
    
    # Convert datetime objects to timestamps for JavaScript
    for notification in notifications:
        notification['scheduled_time'] = int(notification['scheduled_time'].timestamp() * 1000)
    
    return JsonResponse(notifications, safe=False)

@csrf_exempt
def delete_notification(request, notification_id):
    if request.method == 'DELETE':
        try:
            notification = Notification.objects.get(id=notification_id)
            notification.delete()
            return JsonResponse({"success": True})
        except Notification.DoesNotExist:
            return JsonResponse({"error": "Notification not found"}, status=404)
    return JsonResponse({"error": "Method not allowed"}, status=405)

# Improved view for saving a subscription
@csrf_exempt
@require_POST
def save_subscription(request):
    try:
        subscription_data = json.loads(request.body)
        
        # Create or update subscription to avoid duplicates
        subscription, created = PushSubscription.objects.update_or_create(
            user=request.user if request.user.is_authenticated else None,
            subscription_json__endpoint=subscription_data.get('endpoint'),
            defaults={'subscription_json': subscription_data}
        )
        
        return JsonResponse({
            "success": True, 
            "id": subscription.id,
            "created": created
        })
    except Exception as e:
        return JsonResponse({"success": False, "error": str(e)}, status=500)

# Enhanced view for scheduling notifications with Celery
@csrf_exempt
@require_POST
def schedule_notification(request):
    try:
        data = json.loads(request.body)
        
        # Create the notification in your database
        notification = Notification.objects.create(
            user=request.user if request.user.is_authenticated else None,
            title=data.get('title'),
            body=data.get('body'),
            scheduled_time=datetime.fromtimestamp(int(data.get('scheduledTime')) / 1000),
            repeat=data.get('repeat', 'none')
        )
        
        # Schedule the push notification using Celery
        schedule_push_notification_task(
            notification_id=notification.id,
            scheduled_time=notification.scheduled_time
        )
        
        return JsonResponse({"success": True, "id": notification.id})
    except Exception as e:
        return JsonResponse({"success": False, "error": str(e)}, status=500)

# Function to schedule a push notification task
def schedule_push_notification_task(notification_id, scheduled_time):
    # Schedule the task to be executed at the scheduled time
    send_push_notification.apply_async(
        args=[notification_id],
        eta=scheduled_time
    )

# Celery task to send push notification
@shared_task
def send_push_notification(notification_id):
    try:
        notification = Notification.objects.get(id=notification_id)
        
        # Mark notification as sent
        notification.sent = True
        notification.save()
        
        # If this is a recurring notification, schedule the next occurrence
        if notification.repeat != 'none':
            if notification.repeat == 'daily':
                next_time = notification.scheduled_time + timedelta(days=1)
            elif notification.repeat == 'weekly':
                next_time = notification.scheduled_time + timedelta(weeks=1)
                
            # Create a new notification for the next occurrence
            new_notification = Notification.objects.create(
                user=notification.user,
                title=notification.title,
                body=notification.body,
                scheduled_time=next_time,
                repeat=notification.repeat
            )
            
            # Schedule the next push notification
            schedule_push_notification_task(new_notification.id, next_time)
        
        # Get all subscriptions for this user
        if notification.user:
            subscriptions = PushSubscription.objects.filter(user=notification.user)
        else:
            subscriptions = PushSubscription.objects.filter(user=None)
            
        # Send push notification to all subscriptions
        for subscription in subscriptions:
            try:
                subscription_data = subscription.subscription_json
                
                payload = json.dumps({
                    "title": notification.title,
                    "body": notification.body,
                    "data": {
                        "notificationId": notification.id
                    }
                })
                
                # VAPID keys should be configured in your settings
                vapid_private_key = settings.VAPID_PRIVATE_KEY
                vapid_claims = {
                    "sub": f"mailto:{settings.VAPID_ADMIN_EMAIL}"
                }
                
                # Send the push notification
                pywebpush.webpush(
                    subscription_info=subscription_data,
                    data=payload,
                    vapid_private_key=vapid_private_key,
                    vapid_claims=vapid_claims
                )
            except Exception as e:
                print(f"Failed to send to subscription {subscription.id}: {str(e)}")
                
    except Notification.DoesNotExist:
        print(f"Notification {notification_id} not found")
    except Exception as e:
        print(f"Error sending push notification: {str(e)}")

# Add this endpoint to your views.py

@csrf_exempt
def send_test_notification(request):
    if request.method == 'POST':
        try:
            print("Received test notification request")
            data = json.loads(request.body.decode('utf-8'))
            subscription = data.get('subscription')
            delay = data.get('delay', 2000)  # Default 2 seconds like Express
            
            print(f"Subscription data: {subscription}")
            
            # For iOS, we need to ensure the delay is not too long
            if delay > 5000:  # Cap at 5 seconds for iOS
                delay = 5000
                
            # Schedule the test notification with the specified delay
            print(f"Scheduling test notification with delay: {delay}ms")
            task = send_test_push_notification.apply_async(
                args=[subscription],
                countdown=delay/1000  # Convert milliseconds to seconds
            )
            print(f"Task scheduled: {task.id}")
            
            return JsonResponse({'success': True, 'task_id': task.id})
        except Exception as e:
            print(f"Error in send_test_notification: {str(e)}")
            return JsonResponse({'success': False, 'error': str(e)}, status=500)
    return JsonResponse({'error': 'Invalid request method'}, status=405)

# Import the task from tasks.py instead of defining it here
from .tasks import send_test_push_notification

@csrf_exempt
def remote_log(request):
    if request.method == 'POST':
        try:
            log_data = json.loads(request.body)
            
            # Log to server console
            print(f"REMOTE LOG [{log_data.get('timestamp')}] [{log_data.get('userAgent')}]: {log_data.get('message')}")
            if log_data.get('data'):
                print(f"DATA: {json.dumps(log_data.get('data'))}")
                
            # You could also save to a database or file
            return JsonResponse({'success': True})
        except Exception as e:
            print(f"Error in remote logging: {str(e)}")
            return JsonResponse({'success': False, 'error': str(e)})
    return JsonResponse({'error': 'Method not allowed'}, status=405)

# Add a custom view to serve the service worker with proper headers
# views.py
def service_worker(request):
    path = os.path.join(settings.BASE_DIR, 'Notifications/static/service-worker.js')
    with open(path, 'r') as file:
        content = file.read()
    
    response = HttpResponse(content, content_type='application/javascript')
    response['Service-Worker-Allowed'] = '/'
    return response
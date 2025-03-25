from django.urls import path
from . import views

urlpatterns = [
    # Main page
    path('', views.index, name='index'),
    
    # Subscription management
    path('api/save-subscription', views.save_subscription, name='save_subscription'),
    
    # Notification management
    path('api/schedule-notification', views.schedule_notification, name='schedule_notification'),
    path('api/delete-notification/<int:notification_id>', views.delete_notification, name='delete_notification'),
    path('api/get-scheduled-notifications', views.get_scheduled_notifications, name='get_notifications'),
    path('api/send-test-notification', views.send_test_notification, name='test_notification'),
    path('api/remote-log', views.remote_log, name='remote_log'),
    path('service-worker.js', views.service_worker, name='service_worker')
]
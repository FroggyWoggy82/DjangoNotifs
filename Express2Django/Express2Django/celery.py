# In Express2Django/celery.py
import os
from celery import Celery

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'Express2Django.settings')

app = Celery('Express2Django')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()
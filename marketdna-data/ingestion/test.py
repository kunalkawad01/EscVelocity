from kiteconnect import KiteConnect
import os



API_KEY = "2xbeidvrouv0nwv3"
API_SECRET = "m3ni9uwnvbys4zhnfu5v8jloypswuarv"

REQUEST_TOKEN = "n74Yxyu8eEoyZP1uF4cEUlLDdmJ1F6uE"

kite = KiteConnect(api_key=API_KEY)

data = kite.generate_session(
    request_token=REQUEST_TOKEN,
    api_secret=API_SECRET
)






print(data["access_token"])




kite = KiteConnect(api_key="2xbeidvrouv0nwv3")
kite.set_access_token(data["access_token"])

try:
    profile = kite.profile()

    print("✅ Connection Successful")
    print(f"User ID      : {profile['user_id']}")
    print(f"User Name    : {profile['user_name']}")
    print(f"Email        : {profile['email']}")
    print(f"Broker       : {profile['broker']}")
    
except Exception as e:
    print("❌ Connection Failed")
    print(e)
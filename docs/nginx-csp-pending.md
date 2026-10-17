# nginx CSP 更新待执行命令(在 3.78 上,需要 orangepi 的 sudo 密码)

sudo cp /opt/onlinegame/deploy/server/nginx/onlinegame.conf /etc/nginx/conf.d/onlinegame.conf
sudo nginx -t && sudo nginx -s reload

# 验证(应看到 img-src 含 9000):
curl -sI http://192.168.3.78/admin/dashboard | grep -i content-security | grep -o 9000

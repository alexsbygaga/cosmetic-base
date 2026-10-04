# Публикация каталога на Oracle Cloud (Always Free)

Пошаговая инструкция: от создания аккаунта до работающего сайта с HTTPS
на бесплатном домене. Весь путь занимает примерно 40–60 минут, деньги
списываться не будут — используются только ресурсы уровня «Always Free».

Что получится: сайт вида `https://cosmetic-base.duckdns.org`, сертификат
Let's Encrypt обновляется автоматически, правки сохраняются на диске сервера
и не теряются при перезапуске. Смотреть каталог сможет любой, а редактировать —
только вы и назначенные вами модераторы.

---

## Шаг 0. Что понадобится

* почта и банковская карта для верификации аккаунта Oracle (для ресурсов
  Always Free списаний нет);
* SSH-клиент. В Windows 10/11 уже есть `ssh` и `scp` — отдельно ставить не нужно;
* 40–60 минут времени.

---

## Шаг 1. Аккаунт Oracle Cloud и виртуальный сервер

1. Зарегистрируйтесь на <https://www.oracle.com/cloud/free/>. При регистрации
   выберите **домашний регион** — тот, который ближе к вам; сменить его потом
   нельзя, а ресурсы Always Free создаются только в домашнем регионе.
2. В консоли откройте **Compute → Instances → Create instance**.
3. Параметры создания:

   | Поле | Значение |
   |---|---|
   | Image | Ubuntu 22.04 (или 24.04) |
   | Shape | **VM.Standard.A1.Flex** (Ampere ARM) |
   | OCPU / Memory | 1 OCPU, 6 GB — можно и 2/12, это тоже бесплатно |
   | Boot volume | 50 GB (по умолчанию) |
   | SSH keys | «Generate a key pair for me» → **скачайте приватный ключ** |

   Если при создании пишет «out of host capacity» — попробуйте другое
   Availability Domain или повторите через некоторое время; это обычная
   ситуация для бесплатных ARM-машин.

4. Дождитесь состояния **Running** и скопируйте **Public IP address** инстанса.

### Закрепите внешний адрес

По умолчанию адрес временный и может измениться. Чтобы домен не «отвалился»:

1. **Networking → Reserved public IPs → Create**, привяжите к вашему инстансу.
2. Либо оставьте как есть — скрипт `keepalive` раз в 10 минут обновляет запись
   в DuckDNS, так что смена адреса подхватится автоматически.

### Откройте порты 80 и 443

В Oracle трафик фильтруется дважды: в облачной сети и на самой машине.

**В облаке:** **Networking → Virtual Cloud Networks → ваша VCN → Security Lists →
Default Security List → Add Ingress Rules**. Добавьте два правила:

| Source CIDR | IP Protocol | Destination Port Range |
|---|---|---|
| 0.0.0.0/0 | TCP | 80 |
| 0.0.0.0/0 | TCP | 443 |

**На машине** это сделает скрипт установки (firewalld или ufw).

---

## Шаг 2. Бесплатный домен DuckDNS

1. Откройте <https://www.duckdns.org> и войдите через GitHub, Google или Twitter.
2. Создайте поддомен, например `cosmetic-base` — получится
   `cosmetic-base.duckdns.org`.
3. В поле **current ip** впишите внешний адрес вашего сервера (и нажмите
   `update ip`). Скопируйте **token** из верхней части страницы — он нужен
   для автоматического обновления адреса.

Позже вы сможете подключить свой домен: в Caddy достаточно заменить строку
с адресом, сертификат перевыпустится сам.

---

## Шаг 3. Подключение к серверу

В Windows откройте PowerShell в папке с скачанным ключом.

```powershell
# права на ключ (иначе ssh откажется)
icacls .\ssh-key-2025-01-01.key /inheritance:r
icacls .\ssh-key-2025-01-01.key /grant:r "$($env:USERNAME):(R)"

# подключение (пользователь для Ubuntu-образов — ubuntu)
ssh -i .\ssh-key-2025-01-01.key ubuntu@<внешний-адрес-сервера>
```

> Для образов Oracle Linux пользователь — `opc`, команды установки пакетов
> отличаются (`dnf` вместо `apt`), но скрипт установки это учитывает.

---

## Шаг 4. Загрузка проекта и установка

Соберите архив у себя на компьютере (в папке проекта):

```powershell
bash deploy/make-release.sh      # если есть WSL или Git Bash
# либо просто заархивируйте папку вручную, исключив data/auth и data/backups
```

Скопируйте архив на сервер:

```powershell
scp -i .\ssh-key-2025-01-01.key .\dist\cosmetic-base-2026-01-01.tar.gz ubuntu@<адрес>:~/
```

На сервере:

```bash
mkdir -p ~/cosmetic-base
tar -xzf ~/cosmetic-base-*.tar.gz -C ~/cosmetic-base
cd ~/cosmetic-base
sudo ./deploy/setup-oracle.sh --domain cosmetic-base.duckdns.org
```

Скрипт поставит Node.js 20 и Caddy, создаст пользователя `cosmetic`, перенесёт
данные в `/var/lib/cosmetic-base`, включит автозапуск, таймеры бэкапа и
keepalive, настроит HTTPS и откроет порты. Повторный запуск безопасен.

Пропишите токен DuckDNS, чтобы адрес обновлялся сам:

```bash
sudo nano /etc/cosmetic-base/keepalive.env
```

```ini
DUCKDNS_DOMAIN=cosmetic-base
DUCKDNS_TOKEN=ваш-токен
```

```bash
sudo systemctl start cosmetic-base-keepalive.service   # проверить сразу
```

---

## Шаг 5. Создание администратора

```bash
sudo -u cosmetic CB_DATA_DIR=/var/lib/cosmetic-base \
  node /opt/cosmetic-base/app/server/create-admin.mjs admin 'ВашПароль123' 'Ваше имя'
```

Пароль — не короче 8 символов, минимум одна буква и одна цифра. После создания
форма «Первый запуск» на сайте больше не появится. Перезапускать сервис не нужно:
он перечитывает список пользователей автоматически.

Откройте `https://cosmetic-base.duckdns.org`. Первый выпуск сертификата
Let's Encrypt занимает до минуты — если браузер ругается, подождите и обновите.

---

## Шаг 6. Проверка

```bash
systemctl status cosmetic-base          # служба работает
systemctl status caddy                  # HTTPS работает
curl -s https://cosmetic-base.duckdns.org/api/health
journalctl -u cosmetic-base -n 30       # логи приложения
systemctl list-timers 'cosmetic-base*'  # бэкап и keepalive запланированы
```

В браузере: войдите под администратором, добавьте модератора
(«Войти» → «Управление пользователями») и проверьте правку любой позиции —
изменение должно сохраниться и остаться после перезапуска:

```bash
sudo systemctl restart cosmetic-base
```

---

## Обновление приложения в будущем

Код и данные разделены, поэтому обновление не затрагивает каталог.

```bash
# 1. загрузите новую версию на сервер
scp -i ключ новый-архив.tar.gz ubuntu@<адрес>:~/

# 2. распакуйте и примените
mkdir -p ~/release && tar -xzf ~/новый-архив.tar.gz -C ~/release
cd ~/release
sudo ./deploy/setup-oracle.sh --domain cosmetic-base.duckdns.org

# 3. перезапуск (скрипт делает это сам, но на всякий случай)
sudo systemctl restart cosmetic-base
```

Скрипт копирует только код и не трогает `/var/lib/cosmetic-base`.

---

## Резервные копии

Таймер `cosmetic-base-backup.timer` создаёт архив данных ежедневно в 03:30
в `/var/backups/cosmetic-base` и хранит 14 дней. Проверить и сделать копию
вручную:

```bash
sudo /opt/cosmetic-base/app/deploy/backup.sh
ls -lh /var/backups/cosmetic-base
```

Скачать копию к себе:

```powershell
scp -i .\ключа ubuntu@<адрес>:/var/backups/cosmetic-base/cosmetic-base_*.tar.gz .
```

Восстановление:

```bash
sudo systemctl stop cosmetic-base
sudo tar -xzf /var/backups/cosmetic-base/cosmetic-base_ДАТА.tar.gz -C /var/lib
sudo chown -R cosmetic:cosmetic /var/lib/cosmetic-base
sudo systemctl start cosmetic-base
```

---

## Если что-то не работает

| Симптом | Что проверить |
|---|---|
| Сайт не открывается, «время ожидания истекло» | Порты 80/443 открыты и в Security List облака, и на машине (`sudo ufw status`); домен указывает на правильный адрес (`dig +short cosmetic-base.duckdns.org`) |
| Сертификат не выпускается | Логи: `sudo journalctl -u caddy -n 50`. Частая причина — порт 80 закрыт или домен смотрит не на этот сервер |
| `502 Bad Gateway` | Приложение не запущено: `sudo systemctl status cosmetic-base`, логи `journalctl -u cosmetic-base -n 50` |
| Не могу войти | Если пароль забыт: `sudo -u cosmetic CB_DATA_DIR=/var/lib/cosmetic-base node /opt/cosmetic-base/app/server/create-admin.mjs admin 'НовыйПароль123'` |
| Правки исчезли после перезапуска | Проверьте, что сервис запущен с `CB_DATA_DIR=/var/lib/cosmetic-base` (`systemctl cat cosmetic-base`) |
| Инстанс отозван Oracle | Регулярный `keepalive` создаёт сетевую активность; проверьте `systemctl list-timers` и токен DuckDNS |

---

## Что стоит знать про бесплатность

* Ресурсы **Always Free** бессрочны, но Oracle может отозвать **простаивающий**
  инстанс: если неделю загрузка процессора, сети и памяти ниже 20 %. Таймер
  `keepalive` каждые 10 минут обновляет DuckDNS и обращается к приложению —
  этого достаточно. Дополнительно можно завести бесплатный внешний мониторинг
  (например, UptimeRobot) на адрес `/api/health` — он даёт ещё и уведомление,
  если сайт упал.
* Следите за письмами Oracle: они предупреждают о плановом обслуживании.
* Данные лежат в `/var/lib/cosmetic-base` — отдельно от кода. Это значит, что
  обновление приложения и эксперименты с кодом не затронут каталог.

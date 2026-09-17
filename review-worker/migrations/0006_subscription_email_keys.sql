-- Match Gmail +tag aliases to one subscription without changing delivery.
ALTER TABLE subscribers ADD COLUMN email_key TEXT;

UPDATE subscribers
SET email_key = CASE
  WHEN substr(email, instr(email, '@') + 1) IN ('gmail.com', 'googlemail.com')
    AND instr(substr(email, 1, instr(email, '@') - 1), '+') > 0
  THEN substr(email, 1, instr(email, '+') - 1) || substr(email, instr(email, '@'))
  ELSE email
END;

CREATE INDEX subscribers_email_key ON subscribers(email_key);
